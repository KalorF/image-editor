// 内置历史记录管理器 - 撤销重做功能
import { EventEmitter } from './EventEmitter';
import type { Editor } from '../Editor';
import { EditorHooks, EditorEvents } from '../types';
import { ImageObject } from '../objects/ImageObject';

export interface HistoryOptions {
  maxHistorySize?: number;
  captureInterval?: number; // 最小捕获间隔（毫秒）
}

interface HistoryState {
  timestamp: number;
  data: any;
  description: string;
}

export class HistoryManager extends EventEmitter {
  private editor: Editor;
  private options: Required<HistoryOptions>;
  private initialState: HistoryState | null = null;

  private history: HistoryState[] = [];
  private currentIndex = -1;
  private lastCaptureTime = 0;
  private isApplyingState = false;
  private enabled = true;
  // 顺序化应用历史：避免快速撤销/重做触发并发 applyState
  private pendingIndex: number | null = null;
  private lastAppliedIndex: number = -2; // -2 作为哨兵值，正常索引范围为 [-1, n-1]

  constructor(editor: Editor, options: HistoryOptions = {}) {
    super();
    this.editor = editor;
    this.options = {
      maxHistorySize: options.maxHistorySize ?? Infinity,
      captureInterval: options.captureInterval ?? 100
    };

    this.bindEditorEvents();
    this.bindHistoryHooks();

    // 记录构造时的初始状态，确保可撤回到“空白/初始”而不崩溃
    try {
      this.setInitialState(this.editor.getState());
    } catch (e) {
      // 保底，不影响后续
      console.warn('Failed to capture initial state for history:', e);
    }
    // 允许紧随其后的首次对象变更立即入栈（不被节流）
    this.lastCaptureTime = 0;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    // 清理监听
    this.unbindEditorEvents();
    this.removeAllListeners();
    // 清理钩子
    // 无专门API批量移除，依赖 editor 生命周期整体清理
  }

  /**
   * 高性能深拷贝方法
   * 优先使用现代浏览器的 structuredClone API，性能比 JSON 方式更好
   * 对于不支持的环境提供 JSON 回退方案
   */
  private deepClone<T>(obj: T): T {
    try {
      // 使用现代浏览器的 structuredClone API
      // 支持更多数据类型且性能更优
      if (typeof structuredClone !== 'undefined') {
        return structuredClone(obj);
      }
    } catch (error) {
      // structuredClone 失败时记录警告但继续使用回退方案
      console.warn('structuredClone failed, falling back to JSON method:', error);
    }

    // 回退到 JSON 深拷贝
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      console.error('Deep clone failed:', error);
      // 如果都失败了，返回原对象（浅拷贝）
      return obj;
    }
  }

  // 提供给插件：可通过 hooks 触发，或直接调用本方法
  captureState(description: string, force: boolean = false): void {
    console.log('captureState', description, force);
    if (!this.enabled) return;
    if (this.isApplyingState) return;

    const now = Date.now();
    if (!force && now - this.lastCaptureTime < this.options.captureInterval) {
      return;
    }

    this.lastCaptureTime = now;

    const state: HistoryState = {
      timestamp: now,
      // 使用高性能深拷贝存储完整编辑器状态，避免引用共享
      data: this.deepClone(this.editor.getState()),
      description
    };


    // 如果当前不在末尾，截断后续历史
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    this.history.push(state);
    this.currentIndex = this.history.length - 1;

    // 限制大小
    if (this.history.length > this.options.maxHistorySize) {
      this.history.shift();
      this.currentIndex--;
    }

    this.editor.emit(EditorEvents.HISTORY_STATE_CAPTURED, {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    this.emit(EditorEvents.HISTORY_STATE_CAPTURED, { state });
  }

  undo(): boolean {
    if (!this.canUndo()) return false;

    const targetIndex = this.currentIndex - 1; // 允许为 -1，表示初始状态
    if (this.isApplyingState) {
      // 正在应用历史，记录最新目标索引，稍后一次性应用
      this.currentIndex = targetIndex;
      this.pendingIndex = targetIndex;
      return true;
    }

    this.currentIndex = targetIndex;
    let state = this.history[this.currentIndex];
    if (state === undefined) {
      state = this.initialState!;
    }
    this.applyState(state);
    this.editor.emit(EditorEvents.HISTORY_UNDO, {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    this.emit(EditorEvents.HISTORY_UNDO, { state });
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;

    const targetIndex = this.currentIndex + 1;
    if (this.isApplyingState) {
      // 正在应用历史，记录最新目标索引，稍后一次性应用
      this.currentIndex = targetIndex;
      this.pendingIndex = targetIndex;
      return true;
    }

    this.currentIndex = targetIndex;
    const state = this.history[this.currentIndex];
    this.applyState(state);

    this.editor.emit(EditorEvents.HISTORY_REDO, {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    this.emit(EditorEvents.HISTORY_REDO, { state });
    return true;
  }

  setInitialState(data: any): void {
    this.initialState = {timestamp: Date.now(), data: this.deepClone(data), description: 'Initial state'};
  }

  canUndo(): boolean {
    return this.currentIndex  > -1;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.lastCaptureTime = 0;
    this.editor.emit(EditorEvents.HISTORY_CLEARED, {});
    this.emit(EditorEvents.HISTORY_CLEARED, {});
  }

  getHistory(): Array<{ timestamp: number; description: string; isCurrent: boolean }>{
    return this.history.map((state, index) => ({
      timestamp: state.timestamp,
      description: state.description,
      isCurrent: index === this.currentIndex
    }));
  }

  goToState(index: number): boolean {
    if (index < 0 || index >= this.history.length) return false;
    if (this.isApplyingState) {
      this.currentIndex = index;
      this.pendingIndex = index;
      return true;
    }
    this.currentIndex = index;
    const state = this.history[index];
    this.applyState(state);
    this.editor.emit(EditorEvents.HISTORY_GOTO, {
      state,
      index,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    this.emit(EditorEvents.HISTORY_GOTO, { state, index });
    return true;
  }

  getStats(): { totalStates: number; currentIndex: number; canUndo: boolean; canRedo: boolean; memoryUsage: number }{
    const memoryUsage = this.history.reduce((total, s) => total + JSON.stringify(s.data).length, 0);
    return {
      totalStates: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsage
    };
  }

  private applyState(state: HistoryState): void {
    this.isApplyingState = true;
    this.lastAppliedIndex = this.currentIndex;
    // 批量状态更新期间暂停渲染，避免闪烁
    this.editor.suspendRendering();
    try {
      this.editor.clearSelection();
      // 保持当前视口，不随历史变化
      const keepViewport = this.editor.viewport.getState();
      const dataToApply = { ...state.data, viewport: keepViewport };
      this.editor.setState(this.deepClone(dataToApply));
    } catch (error) {
      console.error('Error applying history state:', error);
    }

    // 定义一次性收尾函数，确保无论正常或超时都能恢复渲染
    let finished = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finalize = () => {
      if (finished) return;
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      this.editor.resumeRendering(true);
      this.isApplyingState = false;
      // 若期间有新的目标索引，顺序化继续应用最新一次请求
      if (this.pendingIndex !== null && this.pendingIndex !== this.lastAppliedIndex) {
        const nextIndex = this.pendingIndex;
        this.pendingIndex = null;
        let nextState = this.history[nextIndex];
        if (nextState === undefined) {
          nextState = this.initialState!;
        }
        this.applyState(nextState);
      }
    };

    // 检查是否有未加载完成的图像对象，若有则等加载完成后再恢复渲染
    try {
      const allObjects = this.editor.objectManager.getAllObjects();
      let pending = 0;

      const onDone = () => {
        pending--;
        if (pending <= 0) {
          finalize();
        }
      };

      // 设置超时保护，最多等待2秒
      timeoutId = setTimeout(() => {
        console.warn('Image loading timeout during history restore, forcing resume');
        finalize();
      }, 2000);

      for (const obj of allObjects) {
        if (obj instanceof ImageObject && obj.isLoaded && typeof obj.isLoaded === 'function') {
          if (!obj.isLoaded()) {
            pending++;
            obj.once('image:loaded', onDone);
            obj.once('image:error', onDone);
          }
        }
      }

      if (pending > 0) {
        return; // 等待所有图像加载后再恢复渲染
      } else {
        // 没有待加载的图像，直接完成
        finalize();
        return;
      }
    } catch (e) {
      // 出错则直接恢复渲染
      console.warn('history resume check failed:', e);
    }

    // 无需等待，立即恢复
    finalize();
  }

  private boundListeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  private bindEditorEvents(): void {
    this.boundListeners = [];
  }

  private unbindEditorEvents(): void {
    this.boundListeners = [];
  }

  private bindHistoryHooks(): void {
    // 插件可以通过 hooks 记录历史
    this.editor.hooks.after(EditorHooks.HISTORY_CAPTURE, (description: string) => {
      if (typeof description === 'string' && description.length > 0) {
        this.captureState(description);
      }
    });
  }
}

