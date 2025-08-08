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

// 插件接口
export interface Plugin {
  name: string;
  version: string;
  install: (editor: any) => void;
  uninstall?: (editor: any) => void;
}

// 钩子类型
export type HookCallback = (...args: any[]) => any;

export interface HookManager {
  before: (hookName: string, callback: HookCallback) => void;
  after: (hookName: string, callback: HookCallback) => void;
  trigger: (hookName: string, ...args: any[]) => any[];
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