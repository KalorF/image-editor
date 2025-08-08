// 历史记录插件 - 撤销重做功能
import type { Plugin } from '../types';
import { Editor } from '../Editor';

interface HistoryState {
  timestamp: number;
  data: any;
  description: string;
}

export interface HistoryPluginOptions {
  maxHistorySize?: number;
  captureInterval?: number; // 最小捕获间隔（毫秒）
}

export class HistoryPlugin implements Plugin {
  name = 'history';
  version = '1.0.0';
  
  private editor!: Editor;
  private options: HistoryPluginOptions;
  
  private history: HistoryState[] = [];
  private currentIndex: number = -1;
  private lastCaptureTime: number = 0;
  private isApplyingState: boolean = false;
  
  constructor(options: HistoryPluginOptions = {}) {
    this.options = {
      maxHistorySize: 50,
      captureInterval: 500,
      ...options
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    
    // 监听对象变化事件
    editor.on('object:added', this.captureState.bind(this, 'Added object'));
    editor.on('object:removed', this.captureState.bind(this, 'Removed object'));
    editor.on('object:moved', this.captureState.bind(this, 'Moved object'));
    editor.on('object:scaled', this.captureState.bind(this, 'Scaled object'));
    editor.on('object:rotated', this.captureState.bind(this, 'Rotated object'));
    
    // 监听撤销重做事件
    editor.on('edit:undo', this.undo.bind(this));
    editor.on('edit:redo', this.redo.bind(this));
    
    // 添加插件方法到编辑器
    (editor as any).history = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      canUndo: () => this.canUndo(),
      canRedo: () => this.canRedo(),
      clear: () => this.clear(),
      getHistory: () => this.getHistory(),
      captureState: (description: string) => this.captureState(description)
    };
    
    // 捕获初始状态
    this.captureState('Initial state');
  }

  uninstall(editor: Editor): void {
    // 移除事件监听
    editor.off('object:added', this.captureState.bind(this, 'Added object'));
    editor.off('object:removed', this.captureState.bind(this, 'Removed object'));
    editor.off('object:moved', this.captureState.bind(this, 'Moved object'));
    editor.off('object:scaled', this.captureState.bind(this, 'Scaled object'));
    editor.off('object:rotated', this.captureState.bind(this, 'Rotated object'));
    editor.off('edit:undo', this.undo);
    editor.off('edit:redo', this.redo);
    
    // 移除插件方法
    delete (editor as any).history;
    
    // 清理历史记录
    this.clear();
  }

  private captureState(description: string): void {
    // 防止在应用状态时重复捕获
    if (this.isApplyingState) {
      return;
    }
    
    // 检查捕获间隔
    const now = Date.now();
    if (now - this.lastCaptureTime < this.options.captureInterval!) {
      return;
    }
    
    this.lastCaptureTime = now;
    
    // 获取当前编辑器状态
    const state: HistoryState = {
      timestamp: now,
      data: this.editor.getState(),
      description
    };
    
    // 如果当前不在历史记录末尾，删除后面的历史
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    
    // 添加新状态
    this.history.push(state);
    this.currentIndex = this.history.length - 1;
    
    // 限制历史记录大小
    if (this.history.length > this.options.maxHistorySize!) {
      this.history.shift();
      this.currentIndex--;
    }
    
    this.editor.emit('history:state-captured', {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
  }

  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }
    
    this.currentIndex--;
    const state = this.history[this.currentIndex];
    
    this.applyState(state);
    
    this.editor.emit('history:undo', {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    }); 
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }
    
    this.currentIndex++;
    const state = this.history[this.currentIndex];
    
    this.applyState(state);
    
    this.editor.emit('history:redo', {
      state,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    
    return true;
  }

  private applyState(state: HistoryState): void {
    this.isApplyingState = true;
    
    try {
      // 清除当前选择
      this.editor.clearSelection();
      
      // 应用状态
      this.editor.setState(state.data);
      
      console.log(`Applied state: ${state.description}`);
    } catch (error) {
      console.error('Error applying history state:', error);
    } finally {
      this.isApplyingState = false;
    }
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.lastCaptureTime = 0;
    
    this.editor.emit('history:cleared');
  }

  getHistory(): Array<{
    timestamp: number;
    description: string;
    isCurrent: boolean;
  }> {
    return this.history.map((state, index) => ({
      timestamp: state.timestamp,
      description: state.description,
      isCurrent: index === this.currentIndex
    }));
  }

  // 跳转到指定历史状态
  goToState(index: number): boolean {
    if (index < 0 || index >= this.history.length) {
      return false;
    }
    
    this.currentIndex = index;
    const state = this.history[index];
    
    this.applyState(state);
    
    this.editor.emit('history:goto', {
      state,
      index,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
    
    return true;
  }

  // 获取当前状态信息
  getCurrentState(): HistoryState | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this.history[this.currentIndex];
    }
    return null;
  }

  // 获取历史记录统计
  getStats(): {
    totalStates: number;
    currentIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    memoryUsage: number; // 简单估算
  } {
    const memoryUsage = this.history.reduce((total, state) => {
      return total + JSON.stringify(state.data).length;
    }, 0);
    
    return {
      totalStates: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsage
    };
  }
}