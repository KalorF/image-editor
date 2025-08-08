// 视口管理器 - 负责画布缩放和移动
import type { Point } from '../types';
import { EventEmitter } from './EventEmitter';
import { MathUtils } from '../utils/math';

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export class Viewport extends EventEmitter {
  private _zoom: number = 1;
  private _panX: number = 0;
  private _panY: number = 0;
  private _width: number = 0;
  private _height: number = 0;
  
  private minZoom: number = 0.1;
  private maxZoom: number = 10;
  
  private isDragging: boolean = false;
  private lastMousePos: Point = { x: 0, y: 0 };
  
  private canvas: HTMLCanvasElement;
  private transform: DOMMatrix;
  
  // 滚轮缩放节流
  private wheelThrottleTimeout: number | null = null;
  private lastWheelTime: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    super();
    this.canvas = canvas;
    this.transform = new DOMMatrix();
    this.updateSize();
    this.bindEvents();
  }

  // 绑定鼠标和键盘事件
  private bindEvents(): void {
    // 滚轮缩放
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    
    // 鼠标拖拽平移
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));
    
    // 窗口大小变化
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  // 处理滚轮事件
  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    
    const currentTime = performance.now();
    
    // 节流滚轮事件，避免过于频繁的缩放
    if (currentTime - this.lastWheelTime < 16) { // 约60fps
      return;
    }
    
    this.lastWheelTime = currentTime;
    
    // 获取正确的鼠标坐标，考虑设备像素比例
    const mousePoint = MathUtils.getCanvasMousePoint(event, this.canvas);
    
    // 计算缩放中心点（世界坐标）
    const worldPoint = this.screenToWorld(mousePoint);
    
    // 计算新的缩放值，使用更小的缩放因子使缩放更平滑
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;;
    const newZoom = MathUtils.clamp(
      this._zoom * zoomFactor,
      this.minZoom,
      this.maxZoom
    );
    
    if (newZoom !== this._zoom) {
      this.zoomToPoint(worldPoint, newZoom);
    }
  }

  // 处理鼠标按下
  private handleMouseDown(event: MouseEvent): void {
    // 只处理中键或按住空格键的左键拖拽
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      event.preventDefault();
      this.isDragging = true;
      // 使用画布坐标而不是客户端坐标
      const mousePoint = MathUtils.getCanvasMousePoint(event, this.canvas);
      this.lastMousePos = mousePoint;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  // 处理鼠标移动
  private handleMouseMove(event: MouseEvent): void {
    if (this.isDragging) {
      // 使用画布坐标计算拖拽偏移
      const mousePoint = MathUtils.getCanvasMousePoint(event, this.canvas);
      const deltaX = mousePoint.x - this.lastMousePos.x;
      const deltaY = mousePoint.y - this.lastMousePos.y;
      
      // 节流拖拽事件
      if (this.wheelThrottleTimeout) {
        return;
      }
      
      this.wheelThrottleTimeout = window.setTimeout(() => {
        this.wheelThrottleTimeout = null;
      }, 8); // 约120fps，拖拽需要更流畅
      
      this.pan(deltaX, deltaY);
      
      this.lastMousePos = mousePoint;
    }
  }

  // 处理鼠标抬起
  private handleMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.style.cursor = 'default';
    }
  }

  // 处理窗口大小变化
  private handleResize(): void {
    this.updateSize();
  }

  // 更新画布尺寸
  updateSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;
    
    // 更新画布实际尺寸 - 只设置canvas尺寸，不在这里缩放context
    // DPR缩放交给Editor的render方法统一处理
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = this._width * devicePixelRatio;
    this.canvas.height = this._height * devicePixelRatio;
    
    this.emit('viewport:resize', { width: this._width, height: this._height });
  }

  // 平移视口
  pan(deltaX: number, deltaY: number): void {
    this._panX += deltaX;
    this._panY += deltaY;
    this.updateTransform();
    this.emit('viewport:pan', { x: this._panX, y: this._panY });
  }

  // 设置缩放
  setZoom(zoom: number, center?: Point): void {
    const newZoom = MathUtils.clamp(zoom, this.minZoom, this.maxZoom);
    
    if (center) {
      this.zoomToPoint(center, newZoom);
    } else {
      this._zoom = newZoom;
      this.updateTransform();
      this.emit('viewport:zoom', { zoom: this._zoom });
    }
  }

  // 缩放到指定点
  private zoomToPoint(worldPoint: Point, newZoom: number): void {
    // 获取鼠标在当前变换下的屏幕位置
    const screenPoint = this.worldToScreen(worldPoint);
    
    // 保存旧的缩放值
    const oldZoom = this._zoom;
    
    // 更新缩放值
    this._zoom = newZoom;
    
    // 计算缩放比例
    const zoomRatio = newZoom / oldZoom;
    
    // 调整平移值，使鼠标位置在缩放后保持在相同的屏幕位置
    // 核心思想：缩放后，鼠标所指向的世界坐标点应该保持在屏幕上的相同位置
    this._panX = screenPoint.x - (screenPoint.x - this._panX) * zoomRatio;
    this._panY = screenPoint.y - (screenPoint.y - this._panY) * zoomRatio;
    
    this.updateTransform();
    this.emit('viewport:zoom', { zoom: this._zoom, center: worldPoint });
  }

  // 适应画布
  fitToCanvas(_margin: number = 50): void {
    const centerX = this._width / 2;
    const centerY = this._height / 2;
    
    this._panX = centerX;
    this._panY = centerY;
    this._zoom = 1;
    
    this.updateTransform();
    this.emit('viewport:fit');
  }

  // 更新变换矩阵
  private updateTransform(): void {
    this.transform = new DOMMatrix()
      .translate(this._panX, this._panY)
      .scale(this._zoom);
  }

  // 屏幕坐标转世界坐标
  screenToWorld(screenPoint: Point): Point {
    const inverse = this.transform.inverse();
    return MathUtils.applyTransform(screenPoint, inverse);
  }

  // 世界坐标转屏幕坐标
  worldToScreen(worldPoint: Point): Point {
    return MathUtils.applyTransform(worldPoint, this.transform);
  }

  // 应用变换到画布上下文
  applyTransform(ctx: CanvasRenderingContext2D): void {
    // 获取当前的DPR缩放
    const devicePixelRatio = window.devicePixelRatio || 1;
    
    // 先应用DPR缩放，再应用viewport变换
    // 这样可以保持DPR缩放不被覆盖
    const combinedTransform = new DOMMatrix()
      .scale(devicePixelRatio, devicePixelRatio)
      .multiply(this.transform);
    
    ctx.setTransform(combinedTransform);
  }

  // 重置变换
  resetTransform(ctx: CanvasRenderingContext2D): void {
    ctx.resetTransform();
  }

  // 获取视口状态
  getState(): ViewportState {
    return {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
      width: this._width,
      height: this._height
    };
  }

  // 设置视口状态
  setState(state: Partial<ViewportState>): void {
    if (state.zoom !== undefined) {
      this._zoom = MathUtils.clamp(state.zoom, this.minZoom, this.maxZoom);
    }
    if (state.panX !== undefined) {
      this._panX = state.panX;
    }
    if (state.panY !== undefined) {
      this._panY = state.panY;
    }
    if (state.width !== undefined) {
      this._width = state.width;
    }
    if (state.height !== undefined) {
      this._height = state.height;
    }
    
    this.updateTransform();
    this.emit('viewport:state-changed', this.getState());
  }

  // 设置缩放范围
  setZoomRange(min: number, max: number): void {
    this.minZoom = Math.max(0.01, min);
    this.maxZoom = Math.max(this.minZoom, max);
    
    // 确保当前缩放值在范围内
    this._zoom = MathUtils.clamp(this._zoom, this.minZoom, this.maxZoom);
    this.updateTransform();
  }

  // 获取可见区域（世界坐标）
  getVisibleBounds(): { left: number; top: number; width: number; height: number } {
    const topLeft = this.screenToWorld({ x: 0, y: 0 });
    const bottomRight = this.screenToWorld({ x: this._width, y: this._height });
    
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }

  // 销毁
  destroy(): void {
    // 清理节流定时器
    if (this.wheelThrottleTimeout) {
      clearTimeout(this.wheelThrottleTimeout);
      this.wheelThrottleTimeout = null;
    }
    
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    window.removeEventListener('resize', this.handleResize);
    this.removeAllListeners();
  }

  // Getters
  get zoom(): number { return this._zoom; }
  get panX(): number { return this._panX; }
  get panY(): number { return this._panY; }
  get width(): number { return this._width; }
  get height(): number { return this._height; }
  get matrix(): DOMMatrix { return this.transform; }
}