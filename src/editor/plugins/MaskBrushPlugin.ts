// 涂抹插件 - 为图像添加mask涂抹功能
import type { Plugin, Point } from '../types';
import { EditorHooks, EditorEvents } from '../types';
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { BaseObject } from '../objects/BaseObject';

export interface MaskBrushPluginOptions {
  enabled?: boolean;
  brushSize?: number;
  mode?: 'add' | 'remove'; // 添加或去除涂抹区域
  opacity?: number;
  color?: string; // mask显示颜色
}

export class MaskBrushPlugin implements Plugin<Editor> {
  name = 'maskBrush';
  version = '1.0.0';
  
  private editor!: Editor;
  private options: MaskBrushPluginOptions;
  
  // 绘制状态
  private isDrawing: boolean = false;
  private currentImageObject: ImageObject | null = null;
  private lastPoint: Point | null = null;
  
  // 鼠标样式相关
  private brushCursor: HTMLElement | null = null;
  private isMouseOverCanvas: boolean = false;
  
  constructor(options: MaskBrushPluginOptions = {}) {
    this.options = {
      enabled: true,
      brushSize: 20,
      mode: 'add',
      opacity: 0.5,
      color: '#FF0000',
      ...options
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    
    // 注册鼠标事件钩子
    this.registerEventHooks();
    
    // 添加插件方法到编辑器
    (editor as any).maskBrush = {
      enable: () => this.enable(),
      disable: () => this.disable(),
      setBrushSize: (size: number) => this.setBrushSize(size),
      setMode: (mode: 'add' | 'remove') => this.setMode(mode),
      setOpacity: (opacity: number) => this.setOpacity(opacity),
      setColor: (color: string) => this.setColor(color),
      clearMask: (imageObj?: ImageObject) => this.clearMask(imageObj),
      isEnabled: () => this.options.enabled,
      getBrushSize: () => this.options.brushSize,
      getMode: () => this.options.mode,
      getOpacity: () => this.options.opacity,
      getColor: () => this.options.color
    };
  }

  uninstall(editor: Editor): void {
    this.unregisterEventHooks();
    this.destroyBrushCursor();
    delete (editor as any).maskBrush;
  }

  private registerEventHooks(): void {
    // 注册鼠标事件钩子
    this.editor.hooks.before(EditorHooks.MOUSE_DOWN, this.onMouseDown);
    this.editor.hooks.before(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.before(EditorHooks.MOUSE_UP, this.onMouseUp);
    this.editor.hooks.before(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.before(EditorHooks.MOUSE_ENTER, this.onMouseEnter);

    // 监听视口缩放事件，更新笔刷光标大小
    this.editor.viewport.on('viewport:zoom', () => {
      this.updateBrushCursorSize();
    });
  }

  private unregisterEventHooks(): void {
    // 移除鼠标事件钩子
    this.editor.hooks.removeHook(EditorHooks.MOUSE_DOWN, this.onMouseDown);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_UP, this.onMouseUp);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_ENTER, this.onMouseEnter);

    this.editor.viewport.off('viewport:zoom', this.updateBrushCursorSize);
  }

  private onMouseDown = (worldPoint: Point, event: MouseEvent) => {
    if (!this.options.enabled || this.editor.getTool() !== 'maskBrush') {
      return; // 未处理事件，继续默认行为
    }

    // 只处理左键点击
    if (event.button !== 0) {
      return; // 未处理事件，继续默认行为
    }

    const hitObject = this.editor.getObjectAt(worldPoint);
    
    if (hitObject && hitObject instanceof ImageObject) {
      this.isDrawing = true;
      this.currentImageObject = hitObject;
      this.lastPoint = worldPoint;
      
      // 确保图像对象有mask
      this.ensureImageHasMask(hitObject);
      
      // 开始绘制
      this.drawMask(worldPoint, hitObject);
      
      // 请求重渲染
      this.editor.requestRender();
      
      event.preventDefault();
      event.stopPropagation();
      return true; // 已处理事件，阻止默认行为
    }
    
    // 没有命中图像对象，继续默认行为
  };

  private onMouseMove = (worldPoint: Point, event: MouseEvent) => {
    // 更新笔刷光标位置
    if (this.options.enabled && this.editor.getTool() === 'maskBrush') {
      this.updateBrushCursor(event);
    }

    if (!this.isDrawing || !this.currentImageObject || !this.lastPoint) {
      return; // 未处理事件，继续默认行为
    }
    
    // 绘制从上一个点到当前点的线段
    this.drawMaskLine(this.lastPoint, worldPoint, this.currentImageObject);
    this.lastPoint = worldPoint;
    
    // 请求重渲染
    this.editor.requestRender();
    
    event.preventDefault();
    return true; // 已处理事件，阻止默认行为
  };

  private onMouseUp = (_worldPoint: Point, _event: MouseEvent) => {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.currentImageObject = null;
      this.lastPoint = null;
      
      // 触发mask变化事件
      this.editor.emit(EditorEvents.MASK_CHANGED, { 
        mode: this.options.mode,
        brushSize: this.options.brushSize 
      });
      // 记录历史（插件影响对象）
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask brushed');
      return true; // 已处理事件，阻止默认行为
    }
    // 未处理事件，继续默认行为
  };

  private onMouseEnter = (_worldPoint: Point, event: MouseEvent) => {
    if (this.options.enabled && this.editor.getTool() === 'maskBrush') {
      this.isMouseOverCanvas = true;
      // 确保光标已创建并显示
      if (!this.brushCursor) {
        this.createBrushCursor();
      }
      this.showBrushCursor();
      this.updateBrushCursor(event);
      return true; // 已处理事件，阻止默认行为
    }
  };

  private onMouseLeave = (worldPoint: Point, event: MouseEvent) => {
    this.isMouseOverCanvas = false;
    this.hideBrushCursor();
    // 如果正在绘制，也要停止
    if (this.isDrawing) {
      return this.onMouseUp(worldPoint, event);
    }
    // 未处理事件，继续默认行为
  };

  private ensureImageHasMask(imageObj: ImageObject): void {
    if (!(imageObj as any).maskCanvas) {
      // 创建mask画布
      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d')!;
      
      maskCanvas.width = imageObj.width;
      maskCanvas.height = imageObj.height;
      
      // 初始化为透明
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      
      (imageObj as any).maskCanvas = maskCanvas;
      (imageObj as any).maskCtx = maskCtx;
      (imageObj as any).hasMask = true;
      
      // 设置初始mask属性
      imageObj.setMaskOpacity(this.options.opacity || 0.5);
      imageObj.setMaskColor(this.options.color || '#FF0000');
    }
  }

  private drawMask(point: Point, imageObj: ImageObject): void {
    const localPoint = this.worldToImageLocal(point, imageObj);
    
    if (!this.isPointInImage(localPoint, imageObj)) {
      return;
    }

    this.drawMaskAtPoint(localPoint, imageObj);
  }

  private drawMaskLine(fromPoint: Point, toPoint: Point, imageObj: ImageObject): void {
    const localFrom = this.worldToImageLocal(fromPoint, imageObj);
    const localTo = this.worldToImageLocal(toPoint, imageObj);
    
    // 使用线段插值来确保连续的笔触
    const distance = Math.sqrt(
      Math.pow(localTo.x - localFrom.x, 2) + 
      Math.pow(localTo.y - localFrom.y, 2)
    );
    
    const steps = Math.max(1, Math.ceil(distance));
    
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const interpolatedPoint = {
        x: localFrom.x + (localTo.x - localFrom.x) * t,
        y: localFrom.y + (localTo.y - localFrom.y) * t
      };
      
      if (this.isPointInImage(interpolatedPoint, imageObj)) {
        this.drawMaskAtPoint(interpolatedPoint, imageObj);
      }
    }
  }

  private drawMaskAtPoint(localPoint: Point, imageObj: ImageObject): void {
    const maskCtx = (imageObj as any).maskCtx as CanvasRenderingContext2D;
    if (!maskCtx) return;

    maskCtx.save();
    
    // 设置笔刷
    maskCtx.globalCompositeOperation = this.options.mode === 'add' ? 'source-over' : 'destination-out';
    // 对于destination-out模式，需要使用可见颜色，alpha通道决定擦除程度
    maskCtx.fillStyle = 'rgba(0, 0, 0, 255)';
    
    // 计算考虑视口缩放和图像缩放的笔刷大小
    const baseBrushSize = this.options?.brushSize || 20;
    const viewportZoom = this.editor.viewport.zoom;
    const imageScale = Math.min(imageObj.transform.scaleX, imageObj.transform.scaleY);
    
    // 笔刷大小 = 基础大小 / (视口缩放 * 图像缩放)
    // 这样可以确保无论视口如何缩放，笔刷的实际大小都保持一致
    const adjustedBrushSize = baseBrushSize / (viewportZoom * imageScale);
    
    // 绘制圆形笔刷
    maskCtx.beginPath();
    maskCtx.arc(localPoint.x, localPoint.y, adjustedBrushSize / 2, 0, Math.PI * 2);
    maskCtx.fill();
    
    maskCtx.restore();
  }

  private worldToImageLocal(worldPoint: Point, imageObj: ImageObject): Point {
    const transform = imageObj.transform;
    
    // 将世界坐标转换为相对于图像中心的坐标
    let relativeX = worldPoint.x - transform.x;
    let relativeY = worldPoint.y - transform.y;
    
    // 应用旋转的逆变换
    if (transform.rotation !== 0) {
      const cos = Math.cos(-transform.rotation);
      const sin = Math.sin(-transform.rotation);
      const rotatedX = relativeX * cos - relativeY * sin;
      const rotatedY = relativeX * sin + relativeY * cos;
      relativeX = rotatedX;
      relativeY = rotatedY;
    }
    
    // 应用缩放的逆变换
    relativeX = relativeX / transform.scaleX;
    relativeY = relativeY / transform.scaleY;
    
    // 转换为图像本地坐标（左上角为原点）
    const localX = relativeX + imageObj.width / 2;
    const localY = relativeY + imageObj.height / 2;
    
    return { x: localX, y: localY };
  }

  private isPointInImage(localPoint: Point, imageObj: ImageObject): boolean {
    return localPoint.x >= 0 && 
           localPoint.x < imageObj.width && 
           localPoint.y >= 0 && 
           localPoint.y < imageObj.height;
  }

  // 笔刷光标相关方法
  private createBrushCursor(): void {
    if (this.brushCursor) {
      return;
    }

    this.brushCursor = document.createElement('div');
    this.brushCursor.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 10000;
      border: 2px solid ${this.options.color || '#FF0000'};
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: transparent;
      opacity: 0.8;
      display: none;
    `;
    
    document.body.appendChild(this.brushCursor);
    this.updateBrushCursorSize();
  }

  private updateBrushCursorSize(): void {
    if (!this.brushCursor) return;
    
    const size = this.options.brushSize || 20;
    this.brushCursor.style.width = `${size}px`;
    this.brushCursor.style.height = `${size}px`;
    this.brushCursor.style.borderColor = this.options.color || '#FF0000';
  }

  private updateBrushCursor(event: MouseEvent): void {
    if (!this.brushCursor || !this.isMouseOverCanvas) return;
    
    this.brushCursor.style.left = `${event.clientX}px`;
    this.brushCursor.style.top = `${event.clientY}px`;
  }

  private showBrushCursor(): void {
    if (!this.brushCursor) {
      this.createBrushCursor();
    }
    
    if (this.brushCursor) {
      this.brushCursor.style.display = 'block';
    }
    
    // 隐藏默认鼠标指针
    const canvas = this.editor.getCanvas();
    canvas.style.cursor = 'none';
  }

  private hideBrushCursor(): void {
    if (this.brushCursor) {
      this.brushCursor.style.display = 'none';
    }
    
    // 恢复默认鼠标指针
    const canvas = this.editor.getCanvas();
    canvas.style.cursor = 'default';
  }

  private destroyBrushCursor(): void {
    if (this.brushCursor) {
      document.body.removeChild(this.brushCursor);
      this.brushCursor = null;
    }
  }

  // 公共方法
  public enable(): void {
    this.options.enabled = true;
    // 立即显示光标，无需检查工具状态
    this.showBrushCursor();
    this.editor.emit(EditorEvents.MASK_BRUSH_ENABLED, {});
  }

  public disable(): void {
    this.options.enabled = false;
    this.isDrawing = false;
    this.currentImageObject = null;
    this.lastPoint = null;
    this.hideBrushCursor();
    this.editor.emit(EditorEvents.MASK_BRUSH_DISABLED, {});
  }

  public setBrushSize(size: number): void {
    this.options.brushSize = Math.max(1, size);
    this.updateBrushCursorSize();
    this.editor.emit(EditorEvents.MASK_BRUSH_SIZE_CHANGED, { size: this.options.brushSize });
  }

  public setMode(mode: 'add' | 'remove'): void {
    this.options.mode = mode;
    this.editor.emit(EditorEvents.MASK_BRUSH_MODE_CHANGED, { mode });
  }

  public setOpacity(opacity: number): void {
    this.options.opacity = Math.max(0, Math.min(1, opacity));
    
    // 更新所有图像对象的mask透明度
    const objects = this.editor.objectManager.getAllObjects();
    objects.forEach((obj: BaseObject) => {
      if (obj instanceof ImageObject && obj.hasMaskData()) {
        obj.setMaskOpacity(this.options.opacity!);
      }
    });
    
    this.editor.requestRender();
    this.editor.emit(EditorEvents.MASK_BRUSH_OPACITY_CHANGED, { opacity: this.options.opacity });
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask opacity changed');
  }

  public setColor(color: string): void {
    this.options.color = color;
    
    // 更新所有图像对象的mask颜色
    const objects = this.editor.objectManager.getAllObjects();
    objects.forEach((obj: BaseObject) => {
      if (obj instanceof ImageObject && obj.hasMaskData()) {
        obj.setMaskColor(color);
      }
    });
    
    this.updateBrushCursorSize(); // 更新光标颜色
    this.editor.requestRender();
    this.editor.emit(EditorEvents.MASK_BRUSH_COLOR_CHANGED, { color });
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask color changed');
  }

  public clearMask(imageObj?: ImageObject): void {
    if (imageObj) {
      this.clearImageMask(imageObj);
    } else {
      // 清除所有图像的mask
      const objects = this.editor.objectManager.getAllObjects();
      objects.forEach((obj: BaseObject) => {
        if (obj instanceof ImageObject) {
          this.clearImageMask(obj);
        }
      });
    }
    
    this.editor.requestRender();
    this.editor.emit(EditorEvents.MASK_CLEARED, { imageObject: imageObj });
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask cleared');
  }

  private clearImageMask(imageObj: ImageObject): void {
    const maskCtx = (imageObj as any).maskCtx as CanvasRenderingContext2D;
    if (maskCtx) {
      const maskCanvas = (imageObj as any).maskCanvas as HTMLCanvasElement;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
  }
}