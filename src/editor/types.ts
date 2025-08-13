// 基础类型定义
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // 弧度
}

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// OBB (Oriented Bounding Box) 定义
export interface OBB {
  center: Point;
  size: Size;
  rotation: number;
  corners: Point[]; // 四个角点
}

// 编辑器事件类型
export interface EditorEvent {
  type: string;
  target?: any;
  data?: any;
  originalEvent?: Event;
}

export type EventHandler = (event: EditorEvent) => void;

// 插件接口 - 使用泛型避免循环依赖
export interface Plugin<T = any> {
  name: string;
  version: string;
  install: (editor: T) => void;
  uninstall?: (editor: T) => void;
}

// ========== 钩子系统类型定义 ==========

// 钩子名称枚举
export const enum EditorHooks {
  // 鼠标事件钩子
  MOUSE_DOWN = 'mouse:down',
  MOUSE_MOVE = 'mouse:move',
  MOUSE_UP = 'mouse:up',
  MOUSE_LEAVE = 'mouse:leave',
  MOUSE_ENTER = 'mouse:enter',
  MOUSE_CLICK = 'mouse:click',
  MOUSE_DOUBLE_CLICK = 'mouse:double-click',
  
  // 键盘事件钩子
  KEY_DOWN = 'key:down',
  KEY_UP = 'key:up',
  
  // 对象操作钩子
  OBJECT_BEFORE_ADD = 'object:before-add',
  OBJECT_AFTER_ADD = 'object:after-add',
  OBJECT_BEFORE_REMOVE = 'object:before-remove',
  OBJECT_AFTER_REMOVE = 'object:after-remove',
  OBJECT_BEFORE_SELECT = 'object:before-select',
  OBJECT_AFTER_SELECT = 'object:after-select',
  OBJECT_DRAG_MOVE = 'object:drag:move',
  OBJECT_DRAG_END = 'object:drag:end',
  
  // 渲染钩子
  RENDER_BEFORE = 'render:before',
  RENDER_AFTER = 'render:after',
  
  // 历史管理钩子
  HISTORY_CAPTURE = 'history:capture'
}

// 钩子参数类型映射
export interface HookParameterMap {
  [EditorHooks.MOUSE_DOWN]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_MOVE]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_UP]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_LEAVE]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_ENTER]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_CLICK]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.MOUSE_DOUBLE_CLICK]: [worldPoint: Point, event: MouseEvent];
  [EditorHooks.KEY_DOWN]: [event: KeyboardEvent];
  [EditorHooks.KEY_UP]: [event: KeyboardEvent];
  [EditorHooks.OBJECT_BEFORE_ADD]: [object: any];
  [EditorHooks.OBJECT_AFTER_ADD]: [object: any];
  [EditorHooks.OBJECT_BEFORE_REMOVE]: [object: any];
  [EditorHooks.OBJECT_AFTER_REMOVE]: [object: any];
  [EditorHooks.OBJECT_BEFORE_SELECT]: [object: any];
  [EditorHooks.OBJECT_AFTER_SELECT]: [object: any];
  [EditorHooks.OBJECT_DRAG_MOVE]: [event: any];
  [EditorHooks.OBJECT_DRAG_END]: [event: any];
  [EditorHooks.RENDER_BEFORE]: [ctx: CanvasRenderingContext2D];
  [EditorHooks.RENDER_AFTER]: [ctx: CanvasRenderingContext2D];
  [EditorHooks.HISTORY_CAPTURE]: [description: string];
}

// 钩子类型联合类型
export type EditorHookType = keyof HookParameterMap;

// 类型安全的钩子回调
export type TypedHookCallback<T extends EditorHookType> = (...args: HookParameterMap[T]) => any;

// 通用钩子回调（向后兼容）
export type HookCallback = (...args: any[]) => any;

// 类型安全的钩子管理器接口
export interface TypedHookManager {
  before<T extends EditorHookType>(
    hookName: T, 
    callback: TypedHookCallback<T>, 
    priority?: number
  ): void;
  
  after<T extends EditorHookType>(
    hookName: T, 
    callback: TypedHookCallback<T>, 
    priority?: number
  ): void;
  
  trigger<T extends EditorHookType>(
    hookName: T, 
    ...args: HookParameterMap[T]
  ): { beforeResults: any[]; afterResults: any[] };
  
  // 向后兼容的方法
  before(hookName: string, callback: HookCallback, priority?: number): void;
  after(hookName: string, callback: HookCallback, priority?: number): void;
  trigger(hookName: string, ...args: any[]): { beforeResults: any[]; afterResults: any[] };
}

// 向后兼容的钩子管理器接口
export interface HookManager {
  before: (hookName: string, callback: HookCallback, priority?: number) => void;
  after: (hookName: string, callback: HookCallback, priority?: number) => void;
  trigger: (hookName: string, ...args: any[]) => { beforeResults: any[]; afterResults: any[] };
}

// 渲染对象基础接口
export interface RenderObject {
  id: string;
  type: string;
  transform: Transform;
  visible: boolean;
  selectable: boolean;
  
  render(ctx: CanvasRenderingContext2D): void;
  getOBB(): OBB;
  hitTest(point: Point): boolean;
  getBounds(): Bounds;
}

// 选择框控制点类型
export const enum ControlPointType {
  TopLeft = 'tl',
  TopRight = 'tr',
  BottomLeft = 'bl',
  BottomRight = 'br',
  MiddleTop = 'mt',
  MiddleBottom = 'mb',
  MiddleLeft = 'ml',
  MiddleRight = 'mr',
  Rotation = 'rotation'
}

export interface ControlPoint {
  type: ControlPointType;
  position: Point;
  cursor: string;
}

// ========== 编辑器事件类型定义 ==========

// 事件名称枚举
export const enum EditorEvents {
  // 编辑器核心事件
  EDITOR_INITIALIZED = 'editor:initialized',
  EDITOR_RENDERED = 'editor:rendered', 
  EDITOR_DESTROYED = 'editor:destroyed',
  
  // 对象操作事件
  OBJECT_ADDED = 'object:added',
  OBJECT_REMOVED = 'object:removed',
  OBJECT_MOVED = 'object:moved',
  OBJECT_SCALED = 'object:scaled',
  OBJECT_ROTATED = 'object:rotated',
  OBJECT_RESIZED = 'object:resized',
  OBJECT_SELECTED = 'object:selected',
  OBJECT_DESELECTED = 'object:deselected',
  OBJECT_COPIED = 'object:copied',
  OBJECT_PASTE_ATTEMPTED = 'object:paste-attempted',
  OBJECT_Z_ORDER_CHANGED = 'object:z-order-changed',
  
  // 视口事件
  VIEWPORT_ZOOM = 'viewport:zoom',
  VIEWPORT_PAN = 'viewport:pan',
  VIEWPORT_RESIZE = 'viewport:resize',
  VIEWPORT_FIT = 'viewport:fit',
  VIEWPORT_STATE_CHANGED = 'viewport:state-changed',
  
  // 鼠标/键盘交互事件
  MOUSE_DOWN = 'mouse:down',
  MOUSE_MOVE = 'mouse:move',
  MOUSE_UP = 'mouse:up',
  MOUSE_CLICK = 'mouse:click',
  MOUSE_DOUBLE_CLICK = 'mouse:double-click',
  MOUSE_LEAVE = 'mouse:leave',
  MOUSE_ENTER = 'mouse:enter',
  KEY_DOWN = 'key:down',
  KEY_UP = 'key:up',
  SPACE_DOWN = 'space:down',
  SPACE_UP = 'space:up',
  
  // 拖拽事件
  DRAG_START = 'drag:start',
  DRAG_MOVE = 'drag:move',
  DRAG_END = 'drag:end',
  OBJECT_DRAG_START = 'object:drag:start',
  OBJECT_DRAG_MOVE = 'object:drag:move',
  OBJECT_DRAG_END = 'object:drag:end',
  
  // 平移事件
  PAN_START = 'pan:start',
  PAN_MOVE = 'pan:move',
  PAN_END = 'pan:end',
  SPACE_PAN_ENABLED = 'space-pan:enabled',
  SPACE_PAN_DISABLED = 'space-pan:disabled',
  
  // 选择事件
  SELECTION_CHANGED = 'selection:changed',
  
  // 历史管理事件
  HISTORY_STATE_CAPTURED = 'history:state-captured',
  HISTORY_UNDO = 'history:undo',
  HISTORY_REDO = 'history:redo',
  HISTORY_CLEARED = 'history:cleared',
  HISTORY_GOTO = 'history:goto',
  HISTORY_ENABLED = 'history:enabled',
  HISTORY_DISABLED = 'history:disabled',
  
  // 插件事件
  PLUGIN_REGISTERED = 'plugin:registered',
  PLUGIN_BEFORE_INSTALL = 'plugin:before-install',
  PLUGIN_INSTALLED = 'plugin:installed',
  PLUGIN_BEFORE_UNINSTALL = 'plugin:before-uninstall',
  PLUGIN_UNINSTALLED = 'plugin:uninstalled',
  
  // 图像相关事件
  IMAGE_LOADED = 'image:loaded',
  IMAGE_ERROR = 'image:error',
  IMAGE_FILTER_ADDED = 'image:filter-added',
  IMAGE_FILTER_REMOVED = 'image:filter-removed',
  IMAGE_FILTERS_CLEARED = 'image:filters-cleared',
  IMAGE_FILTERS_CHANGED = 'image:filters-changed',
  IMAGE_DATA_CHANGED = 'image:data-changed',
  IMAGE_CROPPED = 'image:cropped',
  
  // 蒙版相关事件
  MASK_OPACITY_CHANGED = 'mask:opacity-changed',
  MASK_COLOR_CHANGED = 'mask:color-changed',
  MASK_DATA_CHANGED = 'mask:data-changed',
  MASK_CLEARED = 'mask:cleared',
  MASK_CHANGED = 'mask:changed',
  
  // 图层事件
  LAYER_CREATED = 'layer:created',
  LAYER_REMOVED = 'layer:removed',
  LAYER_ACTIVE_CHANGED = 'layer:active-changed',
  LAYER_VISIBILITY_CHANGED = 'layer:visibility-changed',
  LAYER_LOCK_CHANGED = 'layer:lock-changed',
  LAYER_NAME_CHANGED = 'layer:name-changed',
  OBJECT_LAYER_CHANGED = 'object:layer-changed',
  OBJECTS_CLEARED = 'objects:cleared',
  
  // 工具和编辑操作事件
  TOOL_CHANGED = 'tool:changed',
  EDIT_UNDO = 'edit:undo',
  EDIT_REDO = 'edit:redo',
  
  // 颜色选择插件事件
  COLOR_SELECTION_COMPLETED = 'colorSelection:completed',
  COLOR_SELECTION_ENABLED = 'colorSelection:enabled',
  COLOR_SELECTION_DISABLED = 'colorSelection:disabled',
  COLOR_SELECTION_TOLERANCE_CHANGED = 'colorSelection:tolerance-changed',
  COLOR_SELECTION_COLOR_CHANGED = 'colorSelection:color-changed',
  COLOR_SELECTION_OPACITY_CHANGED = 'colorSelection:opacity-changed',
  COLOR_SELECTION_MODE_CHANGED = 'colorSelection:mode-changed',
  COLOR_SELECTION_CLEARED = 'colorSelection:cleared',
  
  // 蒙版画笔插件事件
  MASK_BRUSH_ENABLED = 'maskBrush:enabled',
  MASK_BRUSH_DISABLED = 'maskBrush:disabled',
  MASK_BRUSH_SIZE_CHANGED = 'maskBrush:brush-size-changed',
  MASK_BRUSH_MODE_CHANGED = 'maskBrush:mode-changed',
  MASK_BRUSH_OPACITY_CHANGED = 'maskBrush:opacity-changed',
  MASK_BRUSH_COLOR_CHANGED = 'maskBrush:color-changed'
}

// 基础事件载荷接口
export interface BaseEventPayload {
  [key: string]: any;
}

// 编辑器核心事件
export interface EditorEventMap {
  [EditorEvents.EDITOR_INITIALIZED]: { editor: any };
  [EditorEvents.EDITOR_RENDERED]: BaseEventPayload;
  [EditorEvents.EDITOR_DESTROYED]: BaseEventPayload;
}

// 对象操作事件
export interface ObjectEventMap {
  [EditorEvents.OBJECT_ADDED]: { object: any; layerId?: string };
  [EditorEvents.OBJECT_REMOVED]: { object: any };
  [EditorEvents.OBJECT_MOVED]: { object: any; deltaX: number; deltaY: number };
  [EditorEvents.OBJECT_SCALED]: { object: any; scaleX: number; scaleY: number };
  [EditorEvents.OBJECT_ROTATED]: { object: any; angle: number };
  [EditorEvents.OBJECT_RESIZED]: { object: any; width: number; height: number };
  [EditorEvents.OBJECT_SELECTED]: { object: any };
  [EditorEvents.OBJECT_DESELECTED]: { object: any };
  [EditorEvents.OBJECT_COPIED]: { object: any };
  [EditorEvents.OBJECT_PASTE_ATTEMPTED]: { data: any };
  [EditorEvents.OBJECT_Z_ORDER_CHANGED]: { object: any; action: 'front' | 'back' | 'forward' | 'backward' };
}

// 视口事件
export interface ViewportEventMap {
  [EditorEvents.VIEWPORT_ZOOM]: { zoom: number; center?: Point };
  [EditorEvents.VIEWPORT_PAN]: { x?: number; y?: number; panX?: number; panY?: number };
  [EditorEvents.VIEWPORT_RESIZE]: { width: number; height: number };
  [EditorEvents.VIEWPORT_FIT]: BaseEventPayload;
  [EditorEvents.VIEWPORT_STATE_CHANGED]: any;
}

// 鼠标/键盘交互事件
export interface InteractionEventMap {
  [EditorEvents.MOUSE_DOWN]: { point: Point; event: MouseEvent; handled: boolean };
  [EditorEvents.MOUSE_MOVE]: { point: Point; event: MouseEvent };
  [EditorEvents.MOUSE_UP]: { point: Point; event: MouseEvent };
  [EditorEvents.MOUSE_CLICK]: { point: Point; event: MouseEvent };
  [EditorEvents.MOUSE_DOUBLE_CLICK]: { point: Point; event: MouseEvent };
  [EditorEvents.MOUSE_LEAVE]: { point: Point; event: MouseEvent };
  [EditorEvents.MOUSE_ENTER]: { point: Point; event: MouseEvent };
  [EditorEvents.KEY_DOWN]: { event: KeyboardEvent };
  [EditorEvents.KEY_UP]: { event: KeyboardEvent };
  [EditorEvents.SPACE_DOWN]: { event: KeyboardEvent };
  [EditorEvents.SPACE_UP]: { event: KeyboardEvent };
}

// 拖拽事件
export interface DragEventMap {
  [EditorEvents.DRAG_START]: { 
    target: any; 
    point: Point; 
    event: MouseEvent; 
    controlPoint?: ControlPointType;
    originalBounds?: Bounds;
  };
  [EditorEvents.DRAG_MOVE]: { 
    target: any; 
    point: Point; 
    event: MouseEvent; 
    deltaX: number; 
    deltaY: number; 
    controlPoint?: ControlPointType;
  };
  [EditorEvents.DRAG_END]: { 
    target: any; 
    point: Point; 
    event: MouseEvent; 
    totalDeltaX: number; 
    totalDeltaY: number; 
    controlPoint?: ControlPointType;
  };
  [EditorEvents.OBJECT_DRAG_START]: BaseEventPayload;
  [EditorEvents.OBJECT_DRAG_MOVE]: BaseEventPayload;
  [EditorEvents.OBJECT_DRAG_END]: BaseEventPayload;
}

// 平移事件
export interface PanEventMap {
  [EditorEvents.PAN_START]: { point: Point; event: MouseEvent };
  [EditorEvents.PAN_MOVE]: { point: Point; deltaX: number; deltaY: number; event: MouseEvent };
  [EditorEvents.PAN_END]: { point: Point; event: MouseEvent };
  [EditorEvents.SPACE_PAN_ENABLED]: BaseEventPayload;
  [EditorEvents.SPACE_PAN_DISABLED]: BaseEventPayload;
}

// 选择事件
export interface SelectionEventMap {
  [EditorEvents.SELECTION_CHANGED]: { oldTarget?: any; newTarget?: any };
}

// 历史管理事件
export interface HistoryEventMap {
  [EditorEvents.HISTORY_STATE_CAPTURED]: { state: any; index?: number };
  [EditorEvents.HISTORY_UNDO]: { state: any; index?: number };
  [EditorEvents.HISTORY_REDO]: { state: any; index?: number };
  [EditorEvents.HISTORY_CLEARED]: BaseEventPayload;
  [EditorEvents.HISTORY_GOTO]: { state: any; index: number };
  [EditorEvents.HISTORY_ENABLED]: BaseEventPayload;
  [EditorEvents.HISTORY_DISABLED]: BaseEventPayload;
}

// 插件事件
export interface PluginEventMap {
  [EditorEvents.PLUGIN_REGISTERED]: { plugin: any };
  [EditorEvents.PLUGIN_BEFORE_INSTALL]: { plugin: any; editor: any };
  [EditorEvents.PLUGIN_INSTALLED]: { plugin: any; editor: any };
  [EditorEvents.PLUGIN_BEFORE_UNINSTALL]: { plugin: any; editor: any };
  [EditorEvents.PLUGIN_UNINSTALLED]: { plugin: any; editor: any };
}

// 图像相关事件
export interface ImageEventMap {
  [EditorEvents.IMAGE_LOADED]: { object: any; image: HTMLImageElement };
  [EditorEvents.IMAGE_ERROR]: { object: any; error: any; src: string };
  [EditorEvents.IMAGE_FILTER_ADDED]: { object: any; filter: any };
  [EditorEvents.IMAGE_FILTER_REMOVED]: { object: any; filter: any };
  [EditorEvents.IMAGE_FILTERS_CLEARED]: { object: any };
  [EditorEvents.IMAGE_FILTERS_CHANGED]: { object: any; filters: any[] };
  [EditorEvents.IMAGE_DATA_CHANGED]: { object: any; imageData: ImageData };
  [EditorEvents.IMAGE_CROPPED]: { object: any; cropRect: { x: number; y: number; width: number; height: number } };
}

// 蒙版相关事件
export interface MaskEventMap {
  [EditorEvents.MASK_OPACITY_CHANGED]: { object: any; opacity: number };
  [EditorEvents.MASK_COLOR_CHANGED]: { object: any; color: string };
  [EditorEvents.MASK_DATA_CHANGED]: { object: any; imageData: ImageData };
  [EditorEvents.MASK_CLEARED]: { object?: any; imageObject?: any };
  [EditorEvents.MASK_CHANGED]: { object: any; imageData: ImageData };
}

// 图层事件
export interface LayerEventMap {
  [EditorEvents.LAYER_CREATED]: { layer: any };
  [EditorEvents.LAYER_REMOVED]: { layerId: string };
  [EditorEvents.LAYER_ACTIVE_CHANGED]: { layerId: string };
  [EditorEvents.LAYER_VISIBILITY_CHANGED]: { layerId: string; visible: boolean };
  [EditorEvents.LAYER_LOCK_CHANGED]: { layerId: string; locked: boolean };
  [EditorEvents.LAYER_NAME_CHANGED]: { layerId: string; name: string };
  [EditorEvents.OBJECT_LAYER_CHANGED]: { object: any; fromLayerId: string; toLayerId: string };
  [EditorEvents.OBJECTS_CLEARED]: BaseEventPayload;
}

// 工具和编辑操作事件
export interface ToolEventMap {
  [EditorEvents.TOOL_CHANGED]: { oldTool: string; newTool: string };
  [EditorEvents.EDIT_UNDO]: BaseEventPayload;
  [EditorEvents.EDIT_REDO]: BaseEventPayload;
}

// 颜色选择插件事件
export interface ColorSelectionEventMap {
  [EditorEvents.COLOR_SELECTION_COMPLETED]: { 
    selection: any; 
    imageData: ImageData; 
    bounds: Bounds; 
    color: string; 
    tolerance: number; 
  };
  [EditorEvents.COLOR_SELECTION_ENABLED]: BaseEventPayload;
  [EditorEvents.COLOR_SELECTION_DISABLED]: BaseEventPayload;
  [EditorEvents.COLOR_SELECTION_TOLERANCE_CHANGED]: { tolerance: number };
  [EditorEvents.COLOR_SELECTION_COLOR_CHANGED]: { color: string };
  [EditorEvents.COLOR_SELECTION_OPACITY_CHANGED]: { opacity: number };
  [EditorEvents.COLOR_SELECTION_MODE_CHANGED]: { mode: string };
  [EditorEvents.COLOR_SELECTION_CLEARED]: BaseEventPayload;
}

// 蒙版画笔插件事件
export interface MaskBrushEventMap {
  [EditorEvents.MASK_BRUSH_ENABLED]: BaseEventPayload;
  [EditorEvents.MASK_BRUSH_DISABLED]: BaseEventPayload;
  [EditorEvents.MASK_BRUSH_SIZE_CHANGED]: { size: number };
  [EditorEvents.MASK_BRUSH_MODE_CHANGED]: { mode: string };
  [EditorEvents.MASK_BRUSH_OPACITY_CHANGED]: { opacity: number };
  [EditorEvents.MASK_BRUSH_COLOR_CHANGED]: { color: string };
}

// 合并所有事件类型
export interface AllEventMap extends 
  EditorEventMap,
  ObjectEventMap,
  ViewportEventMap,
  InteractionEventMap,
  DragEventMap,
  PanEventMap,
  SelectionEventMap,
  HistoryEventMap,
  PluginEventMap,
  ImageEventMap,
  MaskEventMap,
  LayerEventMap,
  ToolEventMap,
  ColorSelectionEventMap,
  MaskBrushEventMap {}

// 事件类型联合类型
export type ImageEditorEventType = keyof AllEventMap;

// 类型安全的事件发射器接口
export interface TypedEventEmitter {
  emit<K extends ImageEditorEventType>(
    eventType: K,
    data: AllEventMap[K],
    target?: any,
    originalEvent?: Event
  ): void;
  
  on<K extends ImageEditorEventType>(
    eventType: K,
    handler: (data: AllEventMap[K], target?: any, originalEvent?: Event) => void
  ): void;
  
  off<K extends ImageEditorEventType>(
    eventType: K,
    handler?: (data: AllEventMap[K], target?: any, originalEvent?: Event) => void
  ): void;
}