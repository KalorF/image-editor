// 视口管理器 - 负责画布缩放和移动
import type { Point } from '../types';
import { EditorEvents } from '../types';
import { MathUtils } from '../utils/math';
import { EventEmitter } from './EventEmitter';

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

  private minZoom: number = 0.05;
  private maxZoom: number = 100;

  private isDragging: boolean = false;
  private lastMousePos: Point = { x: 0, y: 0 };

  private lastZoomMousePos: Point | null = null;
  // 记录最后一次鼠标缩放时间，用于判断是否应该清除记录
  private lastZoomTime: number = 0;
  // 鼠标缩放记录的有效期（毫秒），超过此时间后使用画布中心
  private readonly ZOOM_MEMORY_TIMEOUT = 3000; // 3秒

  private canvas: HTMLCanvasElement;
  private transform: DOMMatrix;

  private deltaScaleMinStep = 0.25;
  private deltaScaleMaxStep = 2;

  // 滚轮缩放节流
  private wheelThrottleTimeout: number | null = null;
  private lastWheelTime: number = 0;
  private initWidth: number = 0;
  private initHeight: number = 0;

  constructor(canvas: HTMLCanvasElement, zoomOptions: { minZoom?: number; maxZoom?: number }) {
    super();
    this.canvas = canvas;
    this.transform = new DOMMatrix();
    this.updateSize();
    this.bindEvents();
    this.minZoom = zoomOptions.minZoom ?? this.minZoom;
    this.maxZoom = zoomOptions.maxZoom ?? this.maxZoom;
    this.initWidth = this.canvas.width;
    this.initHeight = this.canvas.height;
  }

  // 绑定鼠标和键盘事件
  private bindEvents(): void {
    // 滚轮缩放
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this));

    // 鼠标拖拽平移
    // this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    // this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    // this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    // this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));

    // 窗口大小变化
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  // 处理滚轮事件
  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    const currentTime = performance.now();

    // 节流滚轮事件，避免过于频繁的缩放
    if (currentTime - this.lastWheelTime < 16) {
      // 约60fps
      return;
    }

    this.lastWheelTime = currentTime;

    // 获取正确的鼠标坐标，考虑设备像素比例
    const mousePoint = MathUtils.getCanvasMousePoint(event, this.canvas);

    this.lastZoomMousePos = { ...mousePoint };
    this.lastZoomTime = currentTime;

    // 计算缩放中心点（世界坐标）
    const worldPoint = this.screenToWorld(mousePoint);

    const step = event.deltaMode ? 20 : 1;
    const deltas = [event.deltaX, event.deltaY];
    const [_deltaX, deltaY] = deltas.map(delta => delta * -step);
    const zoomFactor = Math.exp(deltaY * 0.005);

    const newZoom = MathUtils.clamp(this._zoom * zoomFactor, this.minZoom, this.maxZoom);

    if (newZoom !== this._zoom) {
      this.zoomToPoint(worldPoint, newZoom);
    }
  }

  get zoomStep(): number {
    return this._zoom >= 10 ? this.deltaScaleMaxStep : this.deltaScaleMinStep;
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
    const container = this.canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;

    // 更新画布实际尺寸 - 只设置canvas尺寸，不在这里缩放context
    // DPR缩放交给Editor的render方法统一处理
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = this._width * devicePixelRatio;
    this.canvas.height = this._height * devicePixelRatio;
    this.canvas.style.width = `${this._width}px`;
    this.canvas.style.height = `${this._height}px`;

    const newZoom = this.canvas.width / this.initWidth;

    this.emit(EditorEvents.VIEWPORT_RESIZE, {
      width: this._width,
      height: this._height,
      zoom: newZoom,
    });
  }

  // 平移视口
  pan(deltaX: number, deltaY: number): void {
    this._panX += deltaX;
    this._panY += deltaY;
    this.updateTransform();
    this.emit(EditorEvents.VIEWPORT_PAN, { x: this._panX, y: this._panY });
  }

  // 设置缩放
  setZoom(zoom: number, center?: Point): void {
    const newZoom = MathUtils.clamp(zoom, this.minZoom, this.maxZoom);

    if (center) {
      this.zoomToPoint(center, newZoom);
    } else {
      this._zoom = newZoom;
      this.updateTransform();
      this.emit(EditorEvents.VIEWPORT_ZOOM, { zoom: this._zoom });
    }
  }

  smartZoom(zoomFactor: number, isCustom = false): void {
    const currentTime = performance.now();
    let newZoom = 1;
    if (isCustom) {
      newZoom = MathUtils.clamp(zoomFactor, this.minZoom, this.maxZoom);
    } else {
      newZoom = MathUtils.clamp(this._zoom + zoomFactor, this.minZoom, this.maxZoom);
    }

    // 检查是否有有效的鼠标缩放记录
    if (this.lastZoomMousePos && currentTime - this.lastZoomTime < this.ZOOM_MEMORY_TIMEOUT) {
      // 使用记录的鼠标位置作为缩放中心
      const worldPoint = this.screenToWorld(this.lastZoomMousePos);
      this.zoomToPoint(worldPoint, newZoom);
    } else {
      // 使用画布中心作为缩放中心
      const canvasCenter: Point = {
        x: this._width / 2,
        y: this._height / 2,
      };
      const worldCenter = this.screenToWorld(canvasCenter);
      this.zoomToPoint(worldCenter, newZoom);
    }
  }

  clearZoomMemory(): void {
    this.lastZoomMousePos = null;
    this.lastZoomTime = 0;
  }

  getZoomCenter(): Point | null {
    const currentTime = performance.now();

    if (this.lastZoomMousePos && currentTime - this.lastZoomTime < this.ZOOM_MEMORY_TIMEOUT) {
      return { ...this.lastZoomMousePos };
    }

    return null;
  }

  // 缩放到指定点
  zoomToPoint(worldPoint: Point, newZoom: number): void {
    // 获取鼠标在当前变换下的屏幕位置
    const screenPoint = this.worldToScreen(worldPoint);

    // 保存旧的缩放值
    const oldZoom = this._zoom;

    // 更新缩放值
    this._zoom = newZoom;

    // 计算缩放比例
    const zoomRatio = newZoom / oldZoom;

    // 调整平移值，使鼠标位置在缩放后保持在相同的屏幕位置
    this._panX = screenPoint.x - (screenPoint.x - this._panX) * zoomRatio;
    this._panY = screenPoint.y - (screenPoint.y - this._panY) * zoomRatio;

    this.updateTransform();
    this.emit(EditorEvents.VIEWPORT_ZOOM, { zoom: this._zoom, center: worldPoint });
  }

  // 适应画布
  fitToCanvas(_margin: number = 50): void {
    const centerX = this._width / 2;
    const centerY = this._height / 2;

    this._panX = centerX;
    this._panY = centerY;
    this._zoom = 1;

    this.updateTransform();
    this.emit(EditorEvents.VIEWPORT_FIT, {});
  }

  // 更新变换矩阵
  private updateTransform(): void {
    this.transform = new DOMMatrix().translate(this._panX, this._panY).scale(this._zoom);
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

  resetViewport(zoom: number = 1) {
    this._panX = 0;
    this._panY = 0;
    this._zoom = zoom;
    this.updateTransform();
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
      height: this._height,
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
    this.emit(EditorEvents.VIEWPORT_STATE_CHANGED, this.getState());
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
      height: bottomRight.y - topLeft.y,
    };
  }

  // 销毁
  destroy(): void {
    // 清理节流定时器
    if (this.wheelThrottleTimeout) {
      clearTimeout(this.wheelThrottleTimeout);
      this.wheelThrottleTimeout = null;
    }

    // 🎯 清理缩放记录
    this.clearZoomMemory();

    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    window.removeEventListener('resize', this.handleResize);
    this.removeAllListeners();
  }

  // Getters
  get zoom(): number {
    return this._zoom;
  }
  get panX(): number {
    return this._panX;
  }
  get panY(): number {
    return this._panY;
  }
  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get matrix(): DOMMatrix {
    return this.transform;
  }
}
