import { Editor } from './Editor';

// 编辑器框架入口文件
export { Editor } from './Editor';
export type { EditorOptions } from './Editor';

// 核心类型
export * from './types';

// 核心模块
export { EventEmitter } from './core/EventEmitter';
export { HookManager } from './core/HookManager';
export { PluginManager } from './core/PluginManager';
export { Viewport } from './core/Viewport';
export { ObjectManager } from './core/ObjectManager';

// 对象类
export { BaseObject } from './objects/BaseObject';
export { ImageObject } from './objects/ImageObject';

// 控制器
export { SelectionBox } from './controls/SelectionBox';

// 工具类
export { MathUtils } from './utils/math';

// 内置插件
export { GridPlugin } from './plugins/GridPlugin';
export { HistoryPlugin } from './plugins/HistoryPlugin';
export { MaskBrushPlugin } from './plugins/MaskBrushPlugin';

// 版本信息
export const VERSION = '1.0.0';

// 默认配置
export const DEFAULT_CONFIG = {
  backgroundColor: '#FFFFFF',
  enableSelection: true,
  enableZoom: true,
  enablePan: true
};

// 创建编辑器的便捷函数
export function createEditor(options: import('./Editor').EditorOptions) {
  return new Editor(options);
}