// 内置历史记录管理器 - 撤销重做功能
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { EditorEvents, EditorHooks, type Transform } from '../types';
import { EventEmitter } from './EventEmitter';

export interface HistoryOptions {
  maxHistorySize?: number;
  captureInterval?: number; // 最小捕获间隔（毫秒）
}

interface HistoryState {
  timestamp: number;
  description: string;
  // 增量快照：只存储变化的部分
  delta: StateDelta;
}

interface StateDelta {
  // 对象变化
  objects?: {
    added?: any[]; // 新增的对象
    removed?: string[]; // 删除的对象ID
    modified?: any[]; // 修改的对象
  };
  // 视口变化
  viewport?: any;
  // 选择变化
  selection?: {
    selectedObjectId?: string | null;
  };
  // 工具变化
  tool?: string;
}

// 完整状态快照（仅用于初始状态）
interface FullStateSnapshot {
  timestamp: number;
  data: any;
  description: string;
}

export class HistoryManager extends EventEmitter {
  private editor: Editor;
  private options: Required<HistoryOptions>;
  private initialState: FullStateSnapshot | null = null;

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
      captureInterval: options.captureInterval ?? 50,
    };

    this.bindEditorEvents();
    this.bindHistoryHooks();

    // 记录构造时的初始状态，确保可撤回到"空白/初始"而不崩溃
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

  setAllHistoryObjectTransform(transform: Transform): void {
    const added = this.history.map(state => state.delta.objects?.added);
    const modified = this.history.map(state => state.delta.objects?.modified);
    const removed = this.history.map(state => state.delta.objects?.removed);
    const all = ([...added, ...modified, ...removed] as any).flat().filter((obj: any) => obj);
    for (const obj of all) {
      (obj as any).transform = transform;
    }
    if (this.initialState?.data?.objects?.objects) {
      this.initialState?.data?.objects?.objects.map((obj: any) => {
        (obj as any).transform = transform;
      });
    }
  }

  /**
   * 计算两个状态之间的增量差异
   */
  private computeDelta(oldState: any, newState: any): StateDelta {
    const delta: StateDelta = {};

    // 比较对象变化
    const oldObjects = oldState.objects?.objects || [];
    const newObjects = newState.objects?.objects || [];

    // 找出新增、删除和修改的对象
    const oldObjectMap = new Map<string, any>(
      oldObjects.map((obj: any) => [obj.id as string, obj]),
    );
    const newObjectMap = new Map<string, any>(
      newObjects.map((obj: any) => [obj.id as string, obj]),
    );

    const added: any[] = [];
    const removed: string[] = [];
    const modified: any[] = [];

    // 检查新增和修改的对象
    for (const [id, newObj] of newObjectMap) {
      if (!oldObjectMap.has(id)) {
        added.push(newObj);
      } else {
        const oldObj = oldObjectMap.get(id);
        if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
          modified.push(newObj);
        }
      }
    }

    // 检查删除的对象
    for (const [id] of oldObjectMap) {
      if (!newObjectMap.has(id)) {
        removed.push(id);
      }
    }

    if (added.length > 0 || removed.length > 0 || modified.length > 0) {
      delta.objects = { added, removed, modified };
    }

    // 比较视口变化
    if (JSON.stringify(oldState.viewport) !== JSON.stringify(newState.viewport)) {
      delta.viewport = newState.viewport;
    }

    // 比较选择变化
    if (oldState.selectedObjectId !== newState.selectedObjectId) {
      delta.selection = { selectedObjectId: newState.selectedObjectId };
    }

    // 比较工具变化
    if (oldState.currentTool !== newState.currentTool) {
      delta.tool = newState.currentTool;
    }

    return delta;
  }

  /**
   * 应用增量到目标状态
   */
  private applyDelta(baseState: any, delta: StateDelta): any {
    const newState = this.deepClone(baseState);

    // 应用对象变化
    if (delta.objects) {
      const objects = newState.objects?.objects || [];

      // 删除对象
      if (delta.objects.removed) {
        newState.objects.objects = objects.filter(
          (obj: any) => !delta.objects!.removed!.includes(obj.id as string),
        );
      }

      // 修改对象
      if (delta.objects.modified) {
        for (const modifiedObj of delta.objects.modified) {
          const index = objects.findIndex((obj: any) => obj.id === modifiedObj.id);
          if (index !== -1) {
            newState.objects.objects[index] = modifiedObj;
          }
        }
      }

      // 新增对象
      if (delta.objects.added) {
        newState.objects.objects.push(...delta.objects.added);
      }
    }

    // 应用视口变化
    if (delta.viewport) {
      newState.viewport = delta.viewport;
    }

    // 应用选择变化
    if (delta.selection) {
      newState.selectedObjectId = delta.selection.selectedObjectId;
    }

    // 应用工具变化
    if (delta.tool !== undefined) {
      newState.currentTool = delta.tool;
    }

    return newState;
  }

  /**
   * 获取指定索引的完整状态
   */
  private getStateAt(index: number): any {
    if (index === -1) {
      // 返回初始状态
      return this.initialState?.data || {};
    }

    // 从初始状态开始，依次应用所有增量
    let state = this.deepClone(this.initialState?.data || {});

    for (let i = 0; i <= index; i++) {
      if (this.history[i]) {
        state = this.applyDelta(state, this.history[i].delta);
      }
    }

    return state;
  }

  // 提供给插件：可通过 hooks 触发，或直接调用本方法
  captureState(description: string, force: boolean = false, callback?: () => void): void {
    if (!this.enabled) return;
    if (this.isApplyingState) return;

    const now = Date.now();
    if (!force && now - this.lastCaptureTime < this.options.captureInterval) {
      return;
    }

    this.lastCaptureTime = now;

    const currentState = this.editor.getState();

    // 计算增量
    let delta: StateDelta;
    if (this.currentIndex === -1) {
      // 第一个状态，与初始状态比较
      const baseState = this.initialState?.data || {};
      delta = this.computeDelta(baseState, currentState);
    } else {
      // 与上一个状态比较
      const previousState = this.getStateAt(this.currentIndex);
      delta = this.computeDelta(previousState, currentState);
    }

    // 如果增量为空，不记录历史
    if (Object.keys(delta).length === 0) {
      callback?.();
      return;
    }

    const state: HistoryState = {
      timestamp: now,
      description,
      delta,
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

    this.editor.emit(EditorEvents.HISTORY_STATE_CHANGED, {
      description,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
    callback?.();
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
    const state = this.getStateAt(this.currentIndex);
    this.applyState(state);
    this.editor.emit(EditorEvents.HISTORY_UNDO, {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
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
    const state = this.getStateAt(this.currentIndex);
    this.applyState(state);

    this.editor.emit(EditorEvents.HISTORY_REDO, {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
    this.emit(EditorEvents.HISTORY_REDO, { state });
    return true;
  }

  setInitialState(data: any): void {
    this.initialState = {
      timestamp: Date.now(),
      data,
      description: 'Initial state',
    };
  }

  canUndo(): boolean {
    return this.currentIndex > -1;
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

  getHistory(): Array<{ timestamp: number; description: string; isCurrent: boolean }> {
    return this.history.map((state, index) => ({
      timestamp: state.timestamp,
      description: state.description,
      isCurrent: index === this.currentIndex,
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
    const state = this.getStateAt(index);
    this.applyState(state);
    this.editor.emit(EditorEvents.HISTORY_GOTO, {
      state,
      index,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
    this.emit(EditorEvents.HISTORY_GOTO, { state, index });
    return true;
  }

  getStats(): {
    totalStates: number;
    currentIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    memoryUsage: number;
  } {
    // 计算增量历史的内存占用
    const memoryUsage = this.history.reduce((total, s) => {
      return total + JSON.stringify(s.delta).length;
    }, 0);

    return {
      totalStates: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsage,
    };
  }

  private applyState(state: any): void {
    this.isApplyingState = true;
    this.lastAppliedIndex = this.currentIndex;
    // 批量状态更新期间暂停渲染，避免闪烁
    this.editor.suspendRendering();
    try {
      this.editor.clearSelection();
      // 保持当前视口，不随历史变化
      const keepViewport = this.editor.viewport.getState();
      const dataToApply = { ...state, viewport: keepViewport };
      this.editor.setState(dataToApply);
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
        const nextState = this.getStateAt(nextIndex);
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
      }, 1000);

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
    this.editor.hooks.after(
      EditorHooks.HISTORY_CAPTURE,
      (description: string, force: boolean = false, callback?: () => void) => {
        if (typeof description === 'string' && description.length > 0) {
          this.captureState(description, force, callback);
        }
      },
    );
  }
}
