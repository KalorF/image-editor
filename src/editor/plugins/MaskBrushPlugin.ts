// 涂抹插件 - 为图像添加mask涂抹功能
import type { Editor } from '../Editor';
import { BaseObject } from '../objects/BaseObject';
import { ImageObject } from '../objects/ImageObject';
import type { Plugin, Point } from '../types';
import { EditorEvents, EditorHooks, EditorTools } from '../types';
import { createGradient, worldToImageLocal } from '../utils/math';

export interface MaskBrushPluginOptions {
  enabled?: boolean;
  brushSize?: number;
  bashHardness?: number;
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
      bashHardness: 1,
      mode: 'add',
      opacity: 0.5,
      color: '#FF0000',
      ...options,
    };
  }

  install(editor: Editor): void {
    this.editor = editor;

    this.registerEventHooks();
  }

  uninstall(_editor: Editor): void {
    this.unregisterEventHooks();
    this.destroyBrushCursor();
  }

  private registerEventHooks(): void {
    // 注册鼠标事件钩子
    this.editor.hooks.before(EditorHooks.MOUSE_DOWN, this.onMouseDown);
    this.editor.hooks.before(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.before(EditorHooks.MOUSE_UP, this.onMouseUp);
    this.editor.hooks.before(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.before(EditorHooks.MOUSE_ENTER, this.onMouseEnter);

    this.editor.on(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
    this.editor.on(EditorEvents.TOOL_CHANGED, this.onToolChanged);

    // 监听视口缩放事件，更新笔刷光标大小
    this.editor.viewport.on(EditorEvents.VIEWPORT_ZOOM, () => {
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

    this.editor.viewport.off(EditorEvents.VIEWPORT_ZOOM, this.updateBrushCursorSize);
    this.editor.off(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
    this.editor.off(EditorEvents.TOOL_CHANGED, this.onToolChanged);
  }

  private onToolChanged = () => {
    if (this.editor.getTool() === EditorTools.MASK_BRUSH) {
      this.showBrushCursor();
    } else {
      this.hideBrushCursor();
    }
  };

  private onMouseDown = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.isPanning) return;

    if (!this.options.enabled || this.editor.getTool() !== EditorTools.MASK_BRUSH) {
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
  };

  private onMouseMove = (worldPoint: Point, event: MouseEvent) => {
    // 更新笔刷光标位置
    if (this.editor.isPanning) return;
    if (this.options.enabled && this.editor.getTool() === EditorTools.MASK_BRUSH) {
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

  private cloneMaskData(canvas: HTMLCanvasElement): ImageData {
    // 创建新的 ImageData 对象
    // const clonedData = new ImageData(
    //   new Uint8ClampedArray(maskData.data),
    //   maskData.width,
    //   maskData.height,
    // );

    // const clonedData = new ImageData(
    //   new Uint8ClampedArray(maskData.data),
    //   maskData.width,
    //   maskData.height,
    // );
    const dom = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = dom.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    return data;
  }

  private onMouseUp = async (_worldPoint: Point, _event: MouseEvent) => {
    if (this.editor.isPanning) return;
    if (this.isDrawing) {
      this.isDrawing = false;

      this.lastPoint = null;
      this.currentImageObject = null;
      this.updateBrushCursor(_event);
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask brushed', true);
      // await new Promise<void>(resolve => {
      //   this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask brushed', true);
      //   const onHistoryCaptured = () => {
      //     this.editor.off(EditorEvents.HISTORY_STATE_CAPTURED, onHistoryCaptured);
      //     resolve();
      //   };
      //   this.editor.on(EditorEvents.HISTORY_STATE_CAPTURED, onHistoryCaptured);
      // });
      // this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Mask brushed', true, () => {
      //   const maskData = this.currentImageObject?.getMaskData() as HTMLCanvasElement;
      //   this.editor.emit(EditorEvents.MASK_CHANGED, {
      //     mode: this.options.mode,
      //     brushSize: this.options.brushSize,
      //     canvasData: this.cloneMaskData(maskData),
      //   });
      //   this.currentImageObject = null;
      // });
      return true; // 已处理事件，阻止默认行为
    }
    // 未处理事件，继续默认行为
  };

  private onMouseEnter = (_worldPoint: Point, event: MouseEvent) => {
    if (this.options.enabled && this.editor.getTool() === EditorTools.MASK_BRUSH) {
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
    const localPoint = worldToImageLocal(point, imageObj);

    if (!this.isPointInImage(localPoint, imageObj)) {
      return;
    }

    this.drawMaskAtPoint(localPoint, imageObj);
  }

  private drawMaskLine(fromPoint: Point, toPoint: Point, imageObj: ImageObject): void {
    const localFrom = worldToImageLocal(fromPoint, imageObj);
    const localTo = worldToImageLocal(toPoint, imageObj);

    // 使用线段插值来确保连续的笔触
    const distance = Math.sqrt(
      Math.pow(localTo.x - localFrom.x, 2) + Math.pow(localTo.y - localFrom.y, 2),
    );

    const steps = Math.max(1, Math.ceil(distance));

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const interpolatedPoint = {
        x: localFrom.x + (localTo.x - localFrom.x) * t,
        y: localFrom.y + (localTo.y - localFrom.y) * t,
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
    maskCtx.globalCompositeOperation =
      this.options.mode === 'add' ? 'source-over' : 'destination-out';

    // 计算考虑视口缩放和图像缩放的笔刷大小
    const baseBrushSize = this.options?.brushSize || 20;
    const bashHardness = this.options?.bashHardness || 1;
    const viewportZoom = this.editor.viewport.zoom;
    const imageScale = Math.min(imageObj.transform.scaleX, imageObj.transform.scaleY);

    // 笔刷大小 = 基础大小 / (视口缩放 * 图像缩放)
    // 这样可以确保无论视口如何缩放，笔刷的实际大小都保持一致
    const adjustedBrushSize = baseBrushSize / (viewportZoom * imageScale);
    // 设置渐变画笔
    const gradientColor = createGradient({
      ctx: maskCtx,
      x: localPoint.x,
      y: localPoint.y,
      size: adjustedBrushSize / 2,
      hardness: bashHardness / 100,
      color: 'rgba(255, 255, 255, 255)',
    });
    maskCtx.fillStyle = gradientColor;

    // 绘制圆形笔刷
    maskCtx.beginPath();
    maskCtx.arc(localPoint.x, localPoint.y, adjustedBrushSize / 2, 0, Math.PI * 2);
    maskCtx.fill();

    maskCtx.restore();

    this.editor.emit(EditorEvents.MASK_BRUSH_DRAW, {
      canvas: imageObj.maskCanvas as HTMLCanvasElement,
    });
  }

  private isPointInImage(localPoint: Point, imageObj: ImageObject): boolean {
    return (
      localPoint.x >= 0 &&
      localPoint.x < imageObj.width &&
      localPoint.y >= 0 &&
      localPoint.y < imageObj.height
    );
  }

  private onCanvasCursorUpdated = ({ cursor, event }: { cursor: string; event?: MouseEvent }) => {
    if (this.editor.getTool() === EditorTools.MASK_BRUSH) {
      if (cursor === 'default') {
        this.showBrushCursor();
      } else if (cursor !== 'none') {
        this.hideBrushCursor();
      }
      if (event) {
        this.updateBrushCursor(event);
      }
    }
  };

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
      justify-content: center;
      align-items: center;
      border: 1px solid #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: transparent;
      opacity: 0.8;
      display: none;
    `;

    document.body.appendChild(this.brushCursor);
    this.updateBrushCursorSize();
  }

  private createCursorInner(): void {
    if (!this.brushCursor) return;
    const existingIcon = this.brushCursor.querySelector('.brush-icon');
    if (existingIcon) {
      existingIcon.remove();
    }

    // 创建加号元素
    const iconElement = document.createElement('div');
    iconElement.className = 'brush-icon';
    iconElement.style.cssText = `
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        font-size: 16px;
        color: #ffffff;
        font-weight: 500;
        pointer-events: none;
        padding-bottom: 2px;
      `;
    if (this.options.mode === 'add') {
      iconElement.textContent = this.options.brushSize && this.options.brushSize <= 12 ? '' : '+';
    } else {
      iconElement.textContent = this.options.brushSize && this.options.brushSize <= 12 ? '' : '-';
    }

    this.brushCursor.appendChild(iconElement);
  }

  private updateBrushCursorSize(): void {
    if (this.editor.getTool() !== EditorTools.MASK_BRUSH) return;
    if (!this.brushCursor) return;

    const size = this.options.brushSize || 20;
    this.brushCursor.style.width = `${size}px`;
    this.brushCursor.style.height = `${size}px`;
    this.brushCursor.style.borderColor = '#ffffff';
    this.createCursorInner();
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
      this.brushCursor.style.display = 'flex';
    }

    this.editor.updateCanvasCursor('none', undefined, false);
  }

  private hideBrushCursor(): void {
    if (this.brushCursor) {
      this.brushCursor.style.display = 'none';
    }
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

  public setBashHardness(hardness: number): void {
    this.options.bashHardness = Math.max(1, hardness);
  }

  public setMode(mode: 'add' | 'remove'): void {
    this.options.mode = mode;
    this.createCursorInner();
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
