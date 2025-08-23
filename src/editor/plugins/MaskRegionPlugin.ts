// 自动蒙版插件 - 根据黑白蒙版自动选择图像区域
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import type { Plugin, Point } from '../types';
import { EditorEvents, EditorHooks, EditorTools } from '../types';
import { convertMaskToTransparent, worldToImageLocal } from '../utils/math';

export interface MaskRegion {
  id: string;
  name: string;
  maskImageData: ImageData;
  regionCanvas: HTMLCanvasElement;
  mode: 'add' | 'remove';
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface MaskRegionPluginOptions {
  enabled?: boolean;
  hoverOpacity?: number; // 悬停时的高亮透明度
  hoverColor?: string; // 悬停时的高亮颜色
  appliedOpacity?: number; // 应用后的蒙版透明度
  appliedColor?: string; // 应用后的蒙版颜色
  mode?: 'add' | 'remove'; // 添加或去除涂抹区域
}

export class MaskRegionPlugin implements Plugin<Editor> {
  name = 'maskRegion';
  version = '1.0.0';

  private editor!: Editor;
  private options: MaskRegionPluginOptions;

  // 蒙版相关状态
  private maskRegions: MaskRegion[] = [];
  private currentImageObject: ImageObject | null = null;
  private hoveredRegion: MaskRegion | null = null;
  private appliedRegions: Set<string> = new Set(); // 已应用的蒙版区域ID

  // 鼠标状态
  private isMouseOverCanvas: boolean = false;

  private cursorDom: HTMLElement | null = null;

  // ⚡ 性能优化: 缓存系统
  private hoverMaskCache = new Map<string, HTMLCanvasElement>(); // 缓存hover效果的画布
  private hoverUpdateThrottle: number = 0; // 节流时间戳
  private readonly THROTTLE_DELAY = 16; // ~60fps，约16ms

  // ⚡ 视口状态检测
  private isViewportChanging: boolean = false;
  private tempRenderMaskCanvas?: HTMLCanvasElement | null = null;

  // 渲染钩子引用
  private renderHook = (ctx: CanvasRenderingContext2D) => this.renderHoverEffect(ctx);

  constructor(options: MaskRegionPluginOptions = {}) {
    this.options = {
      enabled: true,
      hoverOpacity: 0.3,
      hoverColor: '#00FF00',
      appliedOpacity: 0.5,
      appliedColor: '#FF0000',
      mode: 'add',
      ...options,
    };
  }

  install(editor: Editor): void {
    this.editor = editor;

    // 注册事件钩子
    this.registerEventHooks();

    // 注册渲染钩子用于绘制悬停效果
    this.editor.hooks.after(EditorHooks.RENDER_AFTER, this.renderHook);
  }

  uninstall(editor: Editor): void {
    this.unregisterEventHooks();
    this.clearMasks();
    this.clearHoverCache();
    this.cursorDom?.remove();
    this.cursorDom = null;

    editor.hooks.removeHook(EditorHooks.RENDER_AFTER, this.renderHook, 'after');
  }

  private registerEventHooks(): void {
    // 注册鼠标事件钩子
    this.editor.hooks.before(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.before(EditorHooks.MOUSE_DOWN, this.onMouseClick);
    this.editor.hooks.before(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.before(EditorHooks.MOUSE_ENTER, this.onMouseEnter);
    this.editor.on(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
    this.editor.on(EditorEvents.TOOL_CHANGED, this.onToolChanged);
  }

  private unregisterEventHooks(): void {
    // 移除鼠标事件钩子
    this.editor.hooks.removeHook(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_DOWN, this.onMouseClick);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_ENTER, this.onMouseEnter);
    this.editor.off(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
    this.editor.off(EditorEvents.TOOL_CHANGED, this.onToolChanged);
  }

  private onToolChanged = () => {
    if (!this.cursorDom) return;
    if (this.editor.getTool() === EditorTools.MASK_REGION) {
      this.cursorDom!.style.display = 'block';
    } else {
      this.cursorDom!.style.display = 'none';
    }
  };

  private onCanvasCursorUpdated = ({ cursor, event }: { cursor: string; event?: MouseEvent }) => {
    if (this.editor.getTool() === EditorTools.MASK_REGION) {
      if (cursor === 'default') {
        this.editor.updateCanvasCursor('none', undefined, false);
        this.cursorDom!.style.display = 'block';
      } else if (cursor !== 'none') {
        this.cursorDom!.style.display = 'none';
      }
      if (event) {
        this.cursorDom!.style.left = `${event.clientX}px`;
        this.cursorDom!.style.top = `${event.clientY}px`;
      }
    }
  };

  private createCursorDom(): void {
    if (this.cursorDom) return;
    this.cursorDom = document.createElement('div');
    this.cursorDom.style.cssText = `
      position: fixed;
      width: 20px;
      height: 20px;
      display: none;
      pointer-events: none;
      transform: translate(-50%, -50%);
      background: transparent;
      z-index: 10000;
    `;
    const crosshairH = document.createElement('div');
    crosshairH.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 100%;
      height: 1.5px;
      border-radius: 2px;
      background: #000000;
      outline: 1px solid #ffffff;
      transform: translate(-50%, -50%);
    `;
    const crosshairV = document.createElement('div');
    crosshairV.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      outline: 1px solid #ffffff;
      border-radius: 2px;
      width: 1.5px;
      height: 100%;
      background: #000000;
      transform: translate(-50%, -50%);
    `;
    const center = document.createElement('div');
    center.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2px;
      height: 2px;
      background-color: #000000;
      opacity: 0.7;
      border: 3px solid transparent;
      border-radius: 50%;
      transform: translate(-50%, -50%);
    `;
    this.cursorDom.appendChild(crosshairH);
    this.cursorDom.appendChild(crosshairV);
    this.cursorDom.appendChild(center);
    document.body.appendChild(this.cursorDom);
  }

  private onMouseMove = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.isPanning) return;
    if (!this.options.enabled || this.editor.getTool() !== EditorTools.MASK_REGION) {
      return; // 未处理事件，继续默认行为
    }

    if (!this.cursorDom) {
      this.createCursorDom();
      this.editor.updateCanvasCursor('none', undefined, false);
    }

    this.cursorDom!.style.display = 'block';
    this.cursorDom!.style.left = `${event.clientX}px`;
    this.cursorDom!.style.top = `${event.clientY}px`;

    // this.editor.updateCanvasCursor(
    //   this.options.mode === 'add' ? 'crosshair' : '',
    //   undefined,
    //   false,
    // );

    // ⚡ 节流优化：限制hover更新频率
    const now = performance.now();
    if (now - this.hoverUpdateThrottle < this.THROTTLE_DELAY) {
      return true; // 跳过此次更新但仍然处理事件
    }
    this.hoverUpdateThrottle = now;

    this.updateHoveredRegion(worldPoint);

    event.preventDefault();
    return true; // 已处理事件，阻止默认行为
  };

  private onMouseClick = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.isPanning) return;
    if (!this.options.enabled || this.editor.getTool() !== EditorTools.MASK_REGION) {
      return; // 未处理事件，继续默认行为
    }

    // 只处理左键点击
    if (event.button !== 0) {
      return; // 未处理事件，继续默认行为
    }

    this.applyMaskAtPoint(worldPoint);

    event.preventDefault();
    event.stopPropagation();
    return true; // 已处理事件，阻止默认行为
  };

  private onMouseEnter = (_worldPoint: Point, _event: MouseEvent) => {
    if (this.options.enabled && this.editor.getTool() === EditorTools.MASK_REGION) {
      this.isMouseOverCanvas = true;
      this.editor.updateCanvasCursor('none', undefined, false);
      return true; // 已处理事件，阻止默认行为
    }
  };

  private onMouseLeave = (_worldPoint: Point, _event: MouseEvent) => {
    this.editor.updateCanvasCursor('default', undefined, false);
    this.cursorDom!.style.display = 'none';
    this.isMouseOverCanvas = false;
    this.hoveredRegion = null;
    this.editor.requestRender();
    this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
      region: null,
    });
  };

  /**
   * 加载蒙版（不再绑定到特定图像对象）
   */
  public loadMasks(masks: MaskRegion[]): void {
    this.maskRegions = masks;
    this.appliedRegions.clear();
    this.hoveredRegion = null;
    this.currentImageObject = null; // 重置当前图像对象，让其自动检测

    // 触发蒙版加载事件
    this.editor.emit(EditorEvents.MASK_REGION_LOADED, {
      maskCount: masks.length,
    });
  }

  /**
   * 清除所有蒙版
   */
  public clearMasks(): void {
    this.maskRegions = [];
    this.currentImageObject = null;
    this.hoveredRegion = null;
    this.appliedRegions.clear();

    // ⚡ 清除缓存
    this.clearHoverCache();

    this.editor.requestRender();

    // 触发蒙版清除事件
    this.editor.emit(EditorEvents.MASK_REGION_CLEARED, {});
  }

  /**
   * ⚡ 清除hover缓存
   */
  private clearHoverCache(): void {
    this.hoverMaskCache.clear();
  }

  /**
   * ⚡ 获取或创建hover蒙版画布
   */
  private getOrCreateHoverCanvas(region: MaskRegion): HTMLCanvasElement {
    const cacheKey = `${region.id}_${this.options.hoverColor}`;

    let canvas = this.hoverMaskCache.get(cacheKey);
    if (!canvas) {
      // 创建新的hover画布
      canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get 2D context');

      canvas.width = region.maskImageData.width;
      canvas.height = region.maskImageData.height;

      // 转换蒙版为指定颜色
      const hoverMaskData = this.convertMaskToColor(
        region.maskImageData,
        this.options.hoverColor || '#00FF00',
      );
      ctx.putImageData(hoverMaskData, 0, 0);

      // 缓存画布
      this.hoverMaskCache.set(cacheKey, canvas);

      // ⚡ LRU缓存清理：保持缓存大小合理
      if (this.hoverMaskCache.size > 10) {
        const firstKey = this.hoverMaskCache.keys().next().value;
        this.hoverMaskCache.delete(firstKey || '');
      }
    }

    return canvas;
  }

  /**
   * 更新悬停的区域
   */
  private updateHoveredRegion(worldPoint: Point): void {
    // 自动查找鼠标位置下的图像对象
    const hitObject = this.editor.getObjectAt(worldPoint);

    // 如果鼠标不在任何图像对象上，清除状态
    if (!hitObject || !(hitObject instanceof ImageObject)) {
      if (this.hoveredRegion || this.currentImageObject) {
        this.hoveredRegion = null;
        this.currentImageObject = null;
        this.editor.requestRender();
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: null,
        });
      }
      return;
    }

    // 更新当前图像对象
    const imageObject = hitObject as ImageObject;

    // 如果切换到不同的图像对象，需要清除之前的状态
    if (this.currentImageObject !== imageObject) {
      this.hoveredRegion = null;
      this.currentImageObject = imageObject;

      // 检查新的图像对象是否有关联的蒙版
      if (this.maskRegions.length === 0 || !this.isImageObjectHasMasks(imageObject)) {
        this.editor.requestRender();
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: null,
        });
        return;
      }
    }

    // 如果没有蒙版数据，直接返回
    if (this.maskRegions.length === 0) {
      if (this.hoveredRegion) {
        this.hoveredRegion = null;
        this.editor.requestRender();
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: null,
        });
      }
      return;
    }

    // 将世界坐标转换为图像本地坐标
    const localPoint = worldToImageLocal(worldPoint, imageObject);

    // 检查是否在图像范围内
    if (!this.isPointInImage(localPoint, imageObject)) {
      if (this.hoveredRegion) {
        this.hoveredRegion = null;
        this.editor.requestRender();
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: null,
        });
      }
      return;
    }

    // 查找鼠标位置对应的蒙版区域
    const region = this.findRegionAtPoint(localPoint);

    if (region !== this.hoveredRegion) {
      this.hoveredRegion = region;
      this.editor.requestRender();

      // 触发悬停事件
      if (region) {
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: region.regionCanvas,
        });
      }
    }
  }

  /**
   * 在指定点应用蒙版
   */
  private applyMaskAtPoint(worldPoint: Point): void {
    // 自动查找鼠标位置下的图像对象
    const hitObject = this.editor.getObjectAt(worldPoint);

    if (!hitObject || !(hitObject instanceof ImageObject)) {
      return;
    }

    const imageObject = hitObject as ImageObject;

    // 更新当前图像对象
    this.currentImageObject = imageObject;

    if (this.maskRegions.length === 0) {
      return;
    }

    // 将世界坐标转换为图像本地坐标
    const localPoint = worldToImageLocal(worldPoint, imageObject);

    // 检查是否在图像范围内
    if (!this.isPointInImage(localPoint, imageObject)) {
      return;
    }

    // 查找鼠标位置对应的蒙版区域
    const region = this.findRegionAtPoint(localPoint);

    if (region) {
      const regionKey = `${imageObject.id || 'default'}_${region.id}`;

      if (this.appliedRegions.has(regionKey)) {
        // 如果已经应用了，则取消应用
        this.unapplyMask(region, imageObject);
        this.appliedRegions.delete(regionKey);
      } else {
        // 否则应用蒙版
        this.applyMask(region, imageObject);
        this.appliedRegions.add(regionKey);
      }
    }
  }

  /**
   * 应用蒙版到图像
   */
  private applyMask(region: MaskRegion, targetImageObject?: ImageObject): void {
    const imageObject = targetImageObject || this.currentImageObject;
    if (!imageObject) return;

    // 确保图像对象有蒙版画布
    this.ensureImageHasMask(imageObject);

    // 获取蒙版画布上下文
    const maskCtx = (imageObject as any).maskCtx as CanvasRenderingContext2D;
    if (!maskCtx) return;

    // 创建临时画布来处理蒙版数据
    if (!this.tempRenderMaskCanvas) {
      this.tempRenderMaskCanvas = document.createElement('canvas');
      this.tempRenderMaskCanvas.width = region.maskImageData.width;
      this.tempRenderMaskCanvas.height = region.maskImageData.height;
    }
    const tempCanvas = this.tempRenderMaskCanvas;
    const tempCtx = tempCanvas.getContext('2d')!;

    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.save();
    tempCtx.drawImage(region.regionCanvas, 0, 0);
    tempCtx.restore();

    // 将蒙版绘制到图像对象的蒙版画布上
    maskCtx.save();
    maskCtx.globalCompositeOperation = 'source-over';

    // 如果蒙版大小与图像大小不同，需要缩放
    if (tempCanvas.width !== imageObject.width || tempCanvas.height !== imageObject.height) {
      maskCtx.drawImage(
        tempCanvas,
        0,
        0,
        tempCanvas.width,
        tempCanvas.height,
        0,
        0,
        imageObject.width,
        imageObject.height,
      );
    } else {
      maskCtx.drawImage(tempCanvas, 0, 0);
    }

    maskCtx.restore();

    // 记录历史
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Applied mask region`, true);

    // 触发应用事件
    this.editor.emit(EditorEvents.MASK_REGION_APPLIED, {
      region: region,
      canvas: imageObject.maskCanvas,
    });

    console.log(`Applied mask region: ${region.name}`);
  }

  /**
   * 取消应用蒙版
   */
  private unapplyMask(region: MaskRegion, targetImageObject?: ImageObject): void {
    const imageObject = targetImageObject || this.currentImageObject;
    if (!imageObject) return;

    const maskCtx = (imageObject as any).maskCtx as CanvasRenderingContext2D;
    if (!maskCtx) return;

    // 创建临时画布来处理蒙版数据
    if (!this.tempRenderMaskCanvas) {
      this.tempRenderMaskCanvas = document.createElement('canvas');
      this.tempRenderMaskCanvas.width = region.maskImageData.width;
      this.tempRenderMaskCanvas.height = region.maskImageData.height;
    }
    const tempCanvas = this.tempRenderMaskCanvas;
    const tempCtx = tempCanvas.getContext('2d')!;

    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.save();
    tempCtx.drawImage(region.regionCanvas, 0, 0);
    tempCtx.restore();

    // 使用destination-out模式擦除对应区域
    maskCtx.save();
    maskCtx.globalCompositeOperation = 'destination-out';

    if (tempCanvas.width !== imageObject.width || tempCanvas.height !== imageObject.height) {
      maskCtx.drawImage(
        tempCanvas,
        0,
        0,
        tempCanvas.width,
        tempCanvas.height,
        0,
        0,
        imageObject.width,
        imageObject.height,
      );
    } else {
      maskCtx.drawImage(tempCanvas, 0, 0);
    }

    maskCtx.restore();

    // 记录历史
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Unapplied mask region`, true);

    // 触发取消应用事件
    this.editor.emit(EditorEvents.MASK_REGION_UNAPPLIED, {
      region: region,
      canvas: imageObject.maskCanvas,
    });

    console.log(`Unapplied mask region: ${region.name}`);
  }

  /**
   * 确保图像对象有蒙版画布
   */
  private ensureImageHasMask(imageObj: ImageObject): void {
    if (!(imageObj as any).maskCanvas) {
      // 创建蒙版画布
      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return;

      maskCanvas.width = imageObj.width;
      maskCanvas.height = imageObj.height;

      // 初始化为透明
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

      (imageObj as any).maskCanvas = maskCanvas;
      (imageObj as any).maskCtx = maskCtx;
      (imageObj as any).hasMask = true;

      // 设置初始蒙版属性
      imageObj.setMaskOpacity(this.options.appliedOpacity || 0.5);
      imageObj.setMaskColor(this.options.appliedColor || '#FF0000');
    }
  }

  /**
   * 根据点查找对应的蒙版区域
   */
  private findRegionAtPoint(localPoint: Point): MaskRegion | null {
    for (const region of this.maskRegions) {
      if (this.isPointInMaskRegion(localPoint, region)) {
        return region;
      }
    }
    return null;
  }

  /**
   * 检查点是否在蒙版区域内
   */
  private isPointInMaskRegion(localPoint: Point, region: MaskRegion): boolean {
    const maskData = region.maskImageData;

    // 将图像坐标转换为蒙版坐标
    const currentImageObject = this.currentImageObject;
    if (!currentImageObject) return false;

    const maskX = Math.floor((localPoint.x / currentImageObject.width) * maskData.width);
    const maskY = Math.floor((localPoint.y / currentImageObject.height) * maskData.height);

    // 边界检查
    if (maskX < 0 || maskX >= maskData.width || maskY < 0 || maskY >= maskData.height) {
      return false;
    }

    // 检查该像素是否为白色（255）或接近白色
    const pixelIndex = (maskY * maskData.width + maskX) * 4;
    const r = maskData.data[pixelIndex];
    const g = maskData.data[pixelIndex + 1];
    const b = maskData.data[pixelIndex + 2];
    const alpha = maskData.data[pixelIndex + 3];

    // 认为RGB值都大于阈值且不透明的像素为有效区域
    const threshold = 128;
    return alpha > 0 && r > threshold && g > threshold && b > threshold;
  }

  /**
   * ⚡ 优化后的渲染悬停效果
   */
  private renderHoverEffect(ctx: CanvasRenderingContext2D): void {
    // 如果视口正在变化，暂停hover渲染以提升性能
    if (this.isViewportChanging) {
      return;
    }

    if (!this.hoveredRegion || !this.currentImageObject || !this.isMouseOverCanvas) {
      return;
    }

    // 保存上下文状态
    ctx.save();

    try {
      // 获取图像对象的变换
      const transform = this.currentImageObject.transform;

      // 应用图像变换
      ctx.translate(transform.x, transform.y);
      ctx.rotate(transform.rotation);
      ctx.scale(transform.scaleX, transform.scaleY);
      ctx.translate(-this.currentImageObject.width / 2, -this.currentImageObject.height / 2);

      // ⚡ 使用缓存的hover画布
      const hoverCanvas = this.getOrCreateHoverCanvas(this.hoveredRegion);

      // 设置透明度和混合模式
      ctx.globalAlpha = this.options.hoverOpacity || 0.3;
      ctx.globalCompositeOperation = 'source-over';

      // ⚡ 优化：直接绘制缓存的画布，避免重复缩放计算
      if (
        hoverCanvas.width !== this.currentImageObject.width ||
        hoverCanvas.height !== this.currentImageObject.height
      ) {
        ctx.drawImage(
          hoverCanvas,
          0,
          0,
          hoverCanvas.width,
          hoverCanvas.height,
          0,
          0,
          this.currentImageObject.width,
          this.currentImageObject.height,
        );
      } else {
        ctx.drawImage(hoverCanvas, 0, 0);
      }
    } finally {
      // 恢复上下文状态
      ctx.restore();
    }
  }

  /**
   * 将黑白蒙版转换为指定颜色的蒙版
   */
  private convertMaskToColor(maskImageData: ImageData, color: string): ImageData {
    const coloredData = new ImageData(maskImageData.width, maskImageData.height);
    const rgb = this.hexToRgb(color);

    for (let i = 0; i < maskImageData.data.length; i += 4) {
      const gray = maskImageData.data[i]; // 使用红色通道作为灰度值
      const alpha = maskImageData.data[i + 3];

      if (gray > 128 && alpha > 0) {
        // 白色区域
        coloredData.data[i] = rgb.r;
        coloredData.data[i + 1] = rgb.g;
        coloredData.data[i + 2] = rgb.b;
        coloredData.data[i + 3] = 255;
      } else {
        // 透明区域
        coloredData.data[i] = 0;
        coloredData.data[i + 1] = 0;
        coloredData.data[i + 2] = 0;
        coloredData.data[i + 3] = 0;
      }
    }

    return coloredData;
  }

  /**
   * 检查点是否在图像内
   */
  private isPointInImage(localPoint: Point, imageObj: ImageObject): boolean {
    return (
      localPoint.x >= 0 &&
      localPoint.x < imageObj.width &&
      localPoint.y >= 0 &&
      localPoint.y < imageObj.height
    );
  }

  /**
   * 检查图像对象是否有关联的蒙版
   */
  private isImageObjectHasMasks(_imageObj: ImageObject): boolean {
    // 这里可以根据具体需求实现更复杂的逻辑
    // 例如：检查蒙版是否与特定图像关联
    // 目前简单返回 true，表示所有蒙版都可以应用到任何图像
    return this.maskRegions.length > 0;
  }

  /**
   * 十六进制颜色转RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 255, g: 0, b: 0 };
  }

  // 公共方法
  public enable(): void {
    this.options.enabled = true;
    this.editor.emit(EditorEvents.MASK_REGION_ENABLED, {});
  }

  public disable(): void {
    this.options.enabled = false;
    this.hoveredRegion = null;
    this.editor.requestRender();
    this.editor.emit(EditorEvents.MASK_REGION_DISABLED, {});
  }

  /**
   * ⚡ 优化：设置hover颜色时清除相关缓存
   */
  public setHoverColor(color: string): void {
    this.options.hoverColor = color;
    // 清除缓存因为颜色变了
    this.clearHoverCache();
    if (this.hoveredRegion) {
      this.editor.requestRender();
    }
  }

  /**
   * ⚡ 优化：设置hover透明度（不需要清除缓存）
   */
  public setHoverOpacity(opacity: number): void {
    this.options.hoverOpacity = opacity;
    if (this.hoveredRegion) {
      this.editor.requestRender();
    }
  }

  public setAppliedColor(color: string): void {
    this.options.appliedColor = color;
    // 更新已应用的蒙版颜色
    if (this.currentImageObject && this.currentImageObject.hasMaskData()) {
      this.currentImageObject.setMaskColor(color);
      this.editor.requestRender();
    }
  }

  public setAppliedOpacity(opacity: number): void {
    this.options.appliedOpacity = Math.max(0, Math.min(1, opacity));
    // 更新已应用的蒙版透明度
    if (this.currentImageObject && this.currentImageObject.hasMaskData()) {
      this.currentImageObject.setMaskOpacity(opacity);
      this.editor.requestRender();
    }
  }

  /**
   * 从图像文件创建蒙版区域
   */
  public async createMaskRegionFromImage(
    id: string,
    name: string,
    imageUrl: string,
  ): Promise<MaskRegion> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          // 创建画布来提取图像数据
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          canvas.width = img.width;
          canvas.height = img.height;

          // 绘制图像
          ctx.drawImage(img, 0, 0);

          // 获取图像数据
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          const regionCanvas = document.createElement('canvas');
          regionCanvas.width = img.width;
          regionCanvas.height = img.height;
          const regionCtx = regionCanvas.getContext('2d');
          if (!regionCtx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          const maskData = convertMaskToTransparent(imageData);
          regionCtx.putImageData(maskData, 0, 0);

          const maskRegion: MaskRegion = {
            id,
            name,
            maskImageData: imageData,
            regionCanvas,
            mode: this.options.mode || 'add',
            bounds: {
              x: 0,
              y: 0,
              width: img.width,
              height: img.height,
            },
          };

          resolve(maskRegion);
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error(`Failed to load mask image: ${imageUrl}`));
      };

      img.src = imageUrl;
    });
  }

  public setMode(mode: 'add' | 'remove'): void {
    this.options.mode = mode;
  }

  public getMode(): 'add' | 'remove' {
    return this.options.mode || 'add';
  }
}
