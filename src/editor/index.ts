import { Editor, type EditorOptions } from './Editor';

// 编辑器框架入口文件
export { Editor } from './Editor';

// 核心类型
export * from './types';

// 核心模块
export { EventEmitter } from './core/EventEmitter';
export { HistoryManager } from './core/HistoryManager';
export { HookManager } from './core/HookManager';
export { ObjectManager } from './core/ObjectManager';
export { PluginManager } from './core/PluginManager';
export { Viewport } from './core/Viewport';

// 对象类
export { BaseObject } from './objects/BaseObject';
export { ImageObject } from './objects/ImageObject';

// 控制器
export { SelectionBox } from './controls/SelectionBox';

// 工具类
export { MathUtils } from './utils/math';

// 版本信息
export const VERSION = '1.0.0';

// 默认配置
export const DEFAULT_CONFIG = {
  backgroundColor: '#FFFFFF',
  enableSelection: true,
  enableZoom: true,
  enablePan: true,
  enableHistory: true,
  history: {
    maxHistorySize: 50,
    captureInterval: Infinity,
  },
};

// 创建编辑器的便捷函数
export function createEditor(options: EditorOptions) {
  return new Editor(options);
}
