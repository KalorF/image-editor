// oxlint-disable no-unsafe-function-type
// 自动蒙版插件 - 根据黑白蒙版自动选择图像区域
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import type { Plugin, Point } from '../types';
import { EditorEvents, EditorHooks, EditorTools } from '../types';
import { worldToImageLocal } from '../utils/math';

// ⚡ Worker 相关类型定义
interface MaskProcessMessage {
  kind: 'convertToTransparent' | 'convertToColor' | 'detectOverlap';
  jobId: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  color?: string;
  maskData2?: Uint8ClampedArray;
}

interface MaskProcessResultMessage {
  kind: 'maskProcess:result';
  jobId: number;
  taskType: string;
  width: number;
  height: number;
  result: Uint8ClampedArray | boolean;
}

export interface MaskRegion {
  id: string;
  name: string;
  maskImageData: ImageData;
  regionCanvas: HTMLCanvasElement | OffscreenCanvas;
  hoverCanvas: HTMLCanvasElement | OffscreenCanvas;
  removeCanvas: HTMLCanvasElement | OffscreenCanvas;
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
  options: MaskRegionPluginOptions;

  // 蒙版相关状态
  private maskRegions: MaskRegion[] = [];
  private currentImageObject: ImageObject | null = null;
  private hoveredRegion: MaskRegion | null = null;
  appliedRegions: Set<string> = new Set(); // 已应用的蒙版区域ID
  initialAppliedRegions: Set<string> = new Set(); // 初始应用的蒙版区域ID

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
  private whitePixelCountCache = new Map<string, number>();

  // ⚡ Worker 相关属性
  private maskWorker: Worker | null = null;
  private workerJobId: number = 0;
  private workerPromises = new Map<number, { resolve: Function; reject: Function }>();

  // 性能阈值：像素数量超过此值时使用 worker
  private readonly WORKER_THRESHOLD = 512 * 512; // 512x512 像素

  private cursorId: string = '_mask-region-cursor';

  private undoAppliedRegions: Set<string>[] = [];
  private redoAppliedRegions: Set<string>[] = [];

  private hoverMode: 'add' | 'remove' = 'add';

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

    // 初始化 worker
    this.initWorker();
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
    this.whitePixelCountCache.clear();

    // 清理 Worker
    if (this.maskWorker) {
      this.maskWorker.terminate();
      this.maskWorker = null;
    }
    this.workerPromises.clear();

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
    this.editor.on(EditorEvents.HISTORY_UNDO, this.onHistoryUndo);
    this.editor.on(EditorEvents.HISTORY_REDO, this.onHistoryRedo);
  }

  private unregisterEventHooks(): void {
    // 移除鼠标事件钩子
    this.editor.hooks.removeHook(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_DOWN, this.onMouseClick);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_ENTER, this.onMouseEnter);
    this.editor.off(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
    this.editor.off(EditorEvents.TOOL_CHANGED, this.onToolChanged);
    this.editor.off(EditorEvents.HISTORY_UNDO, this.onHistoryUndo);
    this.editor.off(EditorEvents.HISTORY_REDO, this.onHistoryRedo);
  }

  private onHistoryUndo = (state: any) => {
    const currentTool = state?.state?.currentTool;

    if (currentTool === EditorTools.MASK_REGION || !currentTool) {
      // undo 时：保存当前状态到 redo 栈，然后恢复上一个状态
      const previousState = this.undoAppliedRegions.pop();
      if (previousState) {
        // 保存当前状态到 redo 栈（用于 redo）
        this.redoAppliedRegions.push(new Set(this.appliedRegions));
        // 恢复到上一个状态
        this.appliedRegions = new Set(previousState);
      }
    }
  };

  private onHistoryRedo = (state: any) => {
    const currentTool = state?.state?.currentTool;
    if (currentTool === EditorTools.MASK_REGION || !currentTool) {
      // redo 时：保存当前状态到 undo 栈，然后恢复下一个状态
      const nextState = this.redoAppliedRegions.pop();
      if (nextState) {
        // 保存当前状态到 undo 栈（用于 undo）
        this.undoAppliedRegions.push(new Set(this.appliedRegions));
        // 恢复到下一个状态
        this.appliedRegions = new Set(nextState);
      }
    }
  };

  private onToolChanged = () => {
    if (!this.cursorDom) return;
    if (this.editor.getTool() === EditorTools.MASK_REGION) {
      // this.cursorDom!.style.display = 'block';
    } else {
      this.cursorDom!.style.display = 'none';
    }
  };

  private onCanvasCursorUpdated = ({ cursor, event }: { cursor: string; event?: MouseEvent }) => {
    if (this.editor.getTool() === EditorTools.MASK_REGION) {
      if (this.editor.disableAllTools && cursor !== 'grabbing' && cursor !== 'grab') {
        this.editor.updateCanvasCursor('default', undefined, false);
        this.cursorDom!.style.display = 'none';
        return;
      }
      if (!this.cursorDom) return;
      if (cursor === 'default') {
        this.editor.updateCanvasCursor('none', undefined, false);
        this.cursorDom!.style.display = 'block';
      } else if (cursor !== 'none') {
        this.cursorDom!.style.display = 'none';
      }
      if (event) {
        // this.cursorDom!.style.left = `${event.clientX}px`;
        // this.cursorDom!.style.top = `${event.clientY}px`;
        this.cursorDom!.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      }
    }
  };

  private createCursorDom(): void {
    if (this.cursorDom) return;

    if (document.getElementById(this.cursorId)) {
      this.cursorDom = document.getElementById(this.cursorId) as HTMLElement;
      return;
    }

    this.cursorDom = document.createElement('div');
    this.cursorDom.id = this.cursorId;
    this.cursorDom.style.cssText = `
      position: fixed;
      width: 16px;
      height: 16px;
      display: none;
      pointer-events: none;
      left: -8px;
      top: -8px;
      background: transparent;
      z-index: 10000;
    `;

    // 外层圆环（白色，带阴影）
    const outerRing = document.createElement('div');
    outerRing.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 12px;
      height: 12px;
      border: 1px solid #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.6), 0 0 3px rgba(0, 0, 0, 0.2);
    `;

    // 中心点
    const centerDot = document.createElement('div');
    centerDot.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 1.5px;
      height: 1.5px;
      background: #000000;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 0.5px #ffffff;
    `;

    // 水平线（左）
    const lineLeft = document.createElement('div');
    lineLeft.style.cssText = `
      position: absolute;
      top: 50%;
      right: 100%;
      width: 4px;
      height: 1px;
      background: #000000;
      transform: translateY(-50%);
      box-shadow: 0 0 0 0.5px #ffffff;
    `;

    // 水平线（右）
    const lineRight = document.createElement('div');
    lineRight.style.cssText = `
      position: absolute;
      top: 50%;
      left: 100%;
      width: 4px;
      height: 1px;
      background: #000000;
      transform: translateY(-50%);
      box-shadow: 0 0 0 0.5px #ffffff;
    `;

    // 垂直线（上）
    const lineTop = document.createElement('div');
    lineTop.style.cssText = `
      position: absolute;
      left: 50%;
      bottom: 100%;
      width: 1px;
      height: 4px;
      background: #000000;
      transform: translateX(-50%);
      box-shadow: 0 0 0 0.5px #ffffff;
    `;

    // 垂直线（下）
    const lineBottom = document.createElement('div');
    lineBottom.style.cssText = `
      position: absolute;
      left: 50%;
      top: 100%;
      width: 1px;
      height: 4px;
      background: #000000;
      transform: translateX(-50%);
      box-shadow: 0 0 0 0.5px #ffffff;
    `;

    // 组装元素
    this.cursorDom.appendChild(outerRing);
    this.cursorDom.appendChild(centerDot);
    this.cursorDom.appendChild(lineLeft);
    this.cursorDom.appendChild(lineRight);
    this.cursorDom.appendChild(lineTop);
    this.cursorDom.appendChild(lineBottom);

    document.body.appendChild(this.cursorDom);
  }

  private onMouseMove = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.isPanning || this.editor.disableAllTools || this.editor.getSpacePressed())
      return;
    if (this.editor.getTool() !== EditorTools.MASK_REGION) {
      if (this.cursorDom) {
        this.cursorDom!.style.display = 'none';
      }
      return; // 未处理事件，继续默认行为
    }

    if (!this.cursorDom && !this.editor.getSpacePressed()) {
      this.createCursorDom();
      this.editor.updateCanvasCursor('none', undefined, false);
    }

    if (this.cursorDom) {
      if (this.editor.getSpacePressed()) {
        this.cursorDom!.style.display = 'none';
      } else {
        this.cursorDom!.style.display = 'block';
      }
      // this.cursorDom!.style.left = `${event.clientX}px`;
      // this.cursorDom!.style.top = `${event.clientY}px`;
      this.cursorDom!.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    }

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
    if (this.editor.isPanning || this.editor.disableAllTools) return;
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
    if (this.editor.disableAllTools) return;
    if (this.options.enabled && this.editor.getTool() === EditorTools.MASK_REGION) {
      this.isMouseOverCanvas = true;
      if (!this.editor.getSpacePressed()) {
        this.editor.updateCanvasCursor('none', undefined, false);
      } else {
        this.editor.updateCanvasCursor('grab', undefined, false);
      }
      return true; // 已处理事件，阻止默认行为
    }
  };

  private onMouseLeave = (_worldPoint: Point, _event: MouseEvent) => {
    if (this.editor.disableAllTools) return;
    this.editor.updateCanvasCursor('default', undefined, false);
    if (!this.cursorDom) return;
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
    this.initialAppliedRegions.clear();
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
    this.whitePixelCountCache.clear();
    this.maskRegions = [];
    this.currentImageObject = null;
    this.hoveredRegion = null;
    this.appliedRegions.clear();
    this.initialAppliedRegions.clear();

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

  private genRegionKey(imageObjectId: string, regionId: string): string {
    return `${regionId}_${imageObjectId}`;
  }

  // /**
  //  * ⚡ 获取或创建hover蒙版画布
  //  */
  // private async getOrCreateHoverCanvasAsync(region: MaskRegion): Promise<HTMLCanvasElement> {
  //   const cacheKey = `${region.id}_${this.options.hoverColor}`;

  //   let canvas = this.hoverMaskCache.get(cacheKey);
  //   if (!canvas) {
  //     canvas = document.createElement('canvas');
  //     const ctx = canvas.getContext('2d');
  //     if (!ctx) throw new Error('Failed to get 2D context');

  //     canvas.width = region.maskImageData.width;
  //     canvas.height = region.maskImageData.height;

  //     // ⚡ 使用 Worker 进行颜色转换
  //     const hoverMaskData = await this.convertMaskToColorAsync(
  //       region.maskImageData,
  //       this.options.hoverColor || '#00FF00',
  //     );
  //     ctx.putImageData(hoverMaskData, 0, 0);

  //     this.hoverMaskCache.set(cacheKey, canvas);

  //     // LRU 缓存清理
  //     if (this.hoverMaskCache.size > 30) {
  //       const firstKey = this.hoverMaskCache.keys().next().value;
  //       this.hoverMaskCache.delete(firstKey || '');
  //     }
  //   }

  //   return canvas;
  // }

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
        const key = this.genRegionKey(imageObject.id, region.id);
        const mode = this.appliedRegions.has(key) ? 'remove' : 'add';
        if (mode === 'add') {
          this.hoverMode = 'add';
        } else {
          this.hoverMode = 'remove';
        }
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: region.regionCanvas,
          mode,
        });
      } else {
        this.editor.emit(EditorEvents.MASK_REGION_HOVER, {
          region: null,
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
      const regionKey = this.genRegionKey(imageObject.id, region.id);

      // 关键修改：在修改前保存当前状态
      this.undoAppliedRegions.push(new Set(this.appliedRegions));
      this.redoAppliedRegions = []; // 清空 redo 栈

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

  private detectPixelOverlap(
    maskCanvas: HTMLCanvasElement | OffscreenCanvas,
    tempCanvas: HTMLCanvasElement | OffscreenCanvas,
  ): boolean {
    const maskCtx = maskCanvas.getContext('2d');
    const tempCtx = tempCanvas.getContext('2d');
    if (!maskCtx || !tempCtx) return false;
    // 类型守卫：确保上下文是 2D 渲染上下文
    if (
      !(maskCtx instanceof CanvasRenderingContext2D) ||
      !(tempCtx instanceof CanvasRenderingContext2D)
    ) {
      return false;
    }

    // 获取重叠区域的像素数据
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const tempData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

    for (let y = 0; y < tempCanvas.height; y += 1) {
      for (let x = 0; x < tempCanvas.width; x += 1) {
        const index = (y * tempCanvas.width + x) * 4;

        // 检查 tempCanvas 在此位置是否有有效像素
        const tempAlpha = tempData.data[index + 3];

        if (tempAlpha > 10) {
          // tempCanvas 有有效像素，检查 maskCanvas 同一位置是否也有有效像素
          const maskAlpha = maskData.data[index + 3];

          if (maskAlpha <= 10) {
            return false; // tempCanvas 有像素但 maskCanvas 没有，不是完全包含
          }
        }
      }
    }

    return true;
  }

  /**
   * 应用蒙版到图像
   */
  private applyMask(region: MaskRegion, targetImageObject?: ImageObject, needHistory = true): void {
    const imageObject = targetImageObject || this.currentImageObject;
    if (!imageObject) return;
    this.hoverMode = 'remove';

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
    if (needHistory) {
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Applied mask region`, true);
    }

    // 触发应用事件
    this.editor.emit(EditorEvents.MASK_REGION_APPLIED, {
      region: region,
      canvas: imageObject.maskCanvas,
      needHistory,
    });

    console.log(`Applied mask region: ${region.name}`);
  }

  /**
   * 取消应用蒙版
   */
  private unapplyMask(region: MaskRegion, targetImageObject?: ImageObject): void {
    const imageObject = targetImageObject || this.currentImageObject;
    if (!imageObject) return;
    this.hoverMode = 'add';

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

  private calculateWhitePixelCount(region: MaskRegion): number {
    // 检查缓存
    if (this.whitePixelCountCache.has(region.id)) {
      return this.whitePixelCountCache.get(region.id)!;
    }

    const maskData = region.maskImageData;
    let whitePixelCount = 0;
    const threshold = 128; // 与 isPointInMaskRegion 中保持一致

    // ⚡ 性能优化：每4个像素跳过检测可以大幅提升性能，对精度影响很小
    const step = 4;

    for (let i = 0; i < maskData.data.length; i += step * 4) {
      const r = maskData.data[i];
      const g = maskData.data[i + 1];
      const b = maskData.data[i + 2];
      const alpha = maskData.data[i + 3];

      // 认为RGB值都大于阈值且不透明的像素为白色像素
      if (alpha > 0 && r > threshold && g > threshold && b > threshold) {
        whitePixelCount++;
      }
    }

    // 因为使用了步长，需要根据步长调整计数
    whitePixelCount *= step;

    // 缓存结果
    this.whitePixelCountCache.set(region.id, whitePixelCount);
    return whitePixelCount;
  }

  /**
   * 根据点查找对应的蒙版区域
   */
  private findRegionAtPoint(localPoint: Point): MaskRegion | null {
    const intersectingRegions: MaskRegion[] = [];

    const filtermasks = this.maskRegions.filter(region => !region.id.includes('merge'));
    // 找到所有与该点相交的蒙版区域
    for (const region of filtermasks) {
      if (this.isPointInMaskRegion(localPoint, region)) {
        intersectingRegions.push(region);
      }
    }

    // 如果没有相交的区域，返回 null
    if (intersectingRegions.length === 0) {
      return null;
    }

    // 如果只有一个相交区域，直接返回
    if (intersectingRegions.length === 1) {
      return intersectingRegions[0];
    }

    // 如果有多个相交区域，选择面积最小的
    let smallestRegion = intersectingRegions[0];
    let smallestWhitePixelCount = this.calculateWhitePixelCount(smallestRegion);

    for (let i = 1; i < intersectingRegions.length; i++) {
      const region = intersectingRegions[i];
      const whitePixelCount = this.calculateWhitePixelCount(region);

      if (whitePixelCount < smallestWhitePixelCount) {
        smallestWhitePixelCount = whitePixelCount;
        smallestRegion = region;
      }
    }

    return smallestRegion;
    // return null;
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

    if (!this.hoveredRegion || !this.currentImageObject) {
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
      // const hoverCanvas = this.getOrCreateHoverCanvas(this.hoveredRegion);
      const hoverCanvas = this.hoveredRegion?.hoverCanvas;
      const removeCanvas = this.hoveredRegion?.removeCanvas;
      const mode = this.hoverMode;
      const applyCanvas = mode === 'add' ? hoverCanvas : removeCanvas;
      // 设置透明度和混合模式
      ctx.globalAlpha = this.options.hoverOpacity || 0.3;
      if (mode === 'remove') {
        ctx.globalAlpha = 0.5;
      }
      ctx.globalCompositeOperation = 'source-over';

      // ⚡ 优化：直接绘制缓存的画布，避免重复缩放计算
      if (
        applyCanvas.width !== this.currentImageObject.width ||
        applyCanvas.height !== this.currentImageObject.height
      ) {
        ctx.drawImage(
          applyCanvas,
          0,
          0,
          applyCanvas.width,
          applyCanvas.height,
          0,
          0,
          this.currentImageObject.width,
          this.currentImageObject.height,
        );
      } else {
        ctx.drawImage(applyCanvas, 0, 0);
      }
    } finally {
      // 恢复上下文状态
      ctx.restore();
    }
  }

  /**
   * 将黑白蒙版转换为指定颜色的蒙版
   */
  private async convertMaskToColorAsync(
    maskImageData: ImageData,
    color: string,
  ): Promise<ImageData> {
    const pixelCount = maskImageData.width * maskImageData.height;

    // 小图像直接在主线程处理
    if (!this.maskWorker || pixelCount < this.WORKER_THRESHOLD) {
      return this.convertMaskToColorSync(maskImageData, color);
    }

    try {
      const result = await this.sendToWorker<Uint8ClampedArray>(
        'convertToColor',
        maskImageData.data,
        maskImageData.width,
        maskImageData.height,
        { color },
      );

      // 创建新的 Uint8ClampedArray 确保类型兼容性
      const resultData = new Uint8ClampedArray(result);
      return new ImageData(resultData, maskImageData.width, maskImageData.height);
    } catch (error) {
      console.warn('Worker failed, falling back to sync processing:', error);
      return this.convertMaskToColorSync(maskImageData, color);
    }
  }

  // 保留同步版本作为备用
  private convertMaskToColorSync(maskImageData: ImageData, color: string): ImageData {
    const coloredData = new ImageData(maskImageData.width, maskImageData.height);
    const rgb = this.hexToRgb(color);

    for (let i = 0; i < maskImageData.data.length; i += 4) {
      const alpha = maskImageData.data[i + 3];
      if (alpha > 0) {
        coloredData.data[i] = rgb.r;
        coloredData.data[i + 1] = rgb.g;
        coloredData.data[i + 2] = rgb.b;
        coloredData.data[i + 3] = 255;
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

  // ⚡ 初始化 Worker
  private async initWorker(): Promise<void> {
    try {
      // 使用动态导入和 ?worker 后缀
      const { default: workerClass } = await import('./workers/maskProcessingWorker.ts?worker');
      this.maskWorker = new workerClass();
      this.maskWorker.onmessage = this.handleWorkerMessage.bind(this);
      this.maskWorker.onerror = this.handleWorkerError.bind(this);
      console.log('Mask Region Worker initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize Mask Region Worker, falling back to main thread:', error);
      this.maskWorker = null;
    }
  }

  // ⚡ 处理 Worker 消息
  private handleWorkerMessage = (event: MessageEvent<MaskProcessResultMessage>) => {
    const msg = event.data;
    if (msg.kind !== 'maskProcess:result') return;

    const promise = this.workerPromises.get(msg.jobId);
    if (promise) {
      this.workerPromises.delete(msg.jobId);
      promise.resolve(msg.result);
    }
  };

  // ⚡ 处理 Worker 错误
  private handleWorkerError = (error: ErrorEvent) => {
    console.error('Mask processing worker error:', error);
    // 清理所有待处理的 promises
    this.workerPromises.forEach(({ reject }) => {
      reject(new Error('Worker failed'));
    });
    this.workerPromises.clear();
  };

  // ⚡ 发送任务到 Worker
  private sendToWorker<T>(
    kind: MaskProcessMessage['kind'],
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: { color?: string; maskData2?: Uint8ClampedArray } = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.maskWorker) {
        reject(new Error('Worker not available'));
        return;
      }

      const jobId = ++this.workerJobId;
      this.workerPromises.set(jobId, { resolve, reject });

      const message: MaskProcessMessage = {
        kind,
        jobId,
        width,
        height,
        data: data.slice(), // 复制数据
        ...options,
      };

      // 使用 Transferable Objects 优化传输
      const transferable: Transferable[] = [message.data.buffer];
      if (options.maskData2) {
        transferable.push(options.maskData2.buffer);
      }

      this.maskWorker.postMessage(message, transferable);
    });
  }

  // ⚡ 优化后的 convertMaskToTransparent（支持 Worker）
  private async convertMaskToTransparentAsync(maskImageData: ImageData): Promise<ImageData> {
    const pixelCount = maskImageData.width * maskImageData.height;

    // 小图像直接在主线程处理
    if (!this.maskWorker || pixelCount < this.WORKER_THRESHOLD) {
      return this.convertMaskToTransparentSync(maskImageData);
    }

    try {
      const result = await this.sendToWorker<Uint8ClampedArray>(
        'convertToTransparent',
        maskImageData.data,
        maskImageData.width,
        maskImageData.height,
      );

      // 确保返回的数据类型正确
      const imageData = new ImageData(
        new Uint8ClampedArray(result),
        maskImageData.width,
        maskImageData.height,
      );

      return imageData;
    } catch (error) {
      console.warn('Worker failed, falling back to sync processing:', error);
      return this.convertMaskToTransparentSync(maskImageData);
    }
  }

  // ⚡ 优化后的 detectPixelOverlap（支持 Worker）
  private async detectPixelOverlapAsync(
    maskCanvas: HTMLCanvasElement | OffscreenCanvas,
    tempCanvas: HTMLCanvasElement | OffscreenCanvas,
  ): Promise<boolean> {
    const pixelCount = maskCanvas.width * maskCanvas.height;

    // 小图像直接在主线程处理
    if (!this.maskWorker || pixelCount < this.WORKER_THRESHOLD) {
      return this.detectPixelOverlapSync(maskCanvas, tempCanvas);
    }

    try {
      const maskCtx = maskCanvas.getContext('2d');
      const tempCtx = tempCanvas.getContext('2d');
      if (!maskCtx || !tempCtx) return false;

      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const tempData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

      const result = await this.sendToWorker<boolean>(
        'detectOverlap',
        maskData.data,
        maskCanvas.width,
        maskCanvas.height,
        { maskData2: tempData.data },
      );

      return result;
    } catch (error) {
      console.warn('Worker failed, falling back to sync processing:', error);
      return this.detectPixelOverlapSync(maskCanvas, tempCanvas);
    }
  }

  // 保留同步版本作为备用
  private convertMaskToTransparentSync(maskImageData: ImageData): ImageData {
    const data = maskImageData.data.slice();
    const data32 = new Uint32Array(data.buffer);
    const len32 = data32.length;

    for (let i = 0; i < len32; i++) {
      const pixel = data32[i];
      const r = pixel & 0xff;
      const g = (pixel >> 8) & 0xff;
      const b = (pixel >> 16) & 0xff;
      const brightness = (r + g + b) / 3;
      data32[i] = (brightness << 24) | (pixel & 0x00ffffff);
    }

    return new ImageData(data, maskImageData.width, maskImageData.height);
  }

  private detectPixelOverlapSync(
    maskCanvas: HTMLCanvasElement | OffscreenCanvas,
    tempCanvas: HTMLCanvasElement | OffscreenCanvas,
  ): boolean {
    const maskCtx = maskCanvas.getContext('2d');
    const tempCtx = tempCanvas.getContext('2d');
    if (!maskCtx || !tempCtx) return false;

    // 类型断言确保是 2D 渲染上下文
    const mask2DCtx = maskCtx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const temp2DCtx = tempCtx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    const maskData = mask2DCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const tempData = temp2DCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

    for (let y = 0; y < tempCanvas.height; y += 1) {
      for (let x = 0; x < tempCanvas.width; x += 1) {
        const index = (y * tempCanvas.width + x) * 4;
        const tempAlpha = tempData.data[index + 3];

        if (tempAlpha > 10) {
          const maskAlpha = maskData.data[index + 3];
          if (maskAlpha <= 10) {
            return false;
          }
        }
      }
    }

    return true;
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

      img.onload = async () => {
        try {
          // 创建画布来提取图像数据
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // 创建区域画布
          const regionCanvas = document.createElement('canvas');
          regionCanvas.width = img.width;
          regionCanvas.height = img.height;
          const regionCtx = regionCanvas.getContext('2d');
          if (!regionCtx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // ⚡ 使用 Worker 进行蒙版透明度转换
          const maskData = await this.convertMaskToTransparentAsync(imageData);
          regionCtx.putImageData(maskData, 0, 0);

          // 创建悬停画布
          const hoverCanvas = document.createElement('canvas');
          hoverCanvas.width = img.width;
          hoverCanvas.height = img.height;
          const hoverCtx = hoverCanvas.getContext('2d');

          const removeCanvas = document.createElement('canvas');
          removeCanvas.width = img.width;
          removeCanvas.height = img.height;
          const removeCtx = removeCanvas.getContext('2d');
          if (!hoverCtx || !removeCtx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // ⚡ 使用 Worker 进行颜色转换
          const hoverData = await this.convertMaskToColorAsync(
            maskData,
            this.options.hoverColor || '#00FF00',
          );

          hoverCtx.putImageData(hoverData, 0, 0);

          const removeData = await this.convertMaskToColorAsync(maskData, '#FF0000');
          removeCtx.putImageData(removeData, 0, 0);

          const maskRegion: MaskRegion = {
            id,
            name,
            maskImageData: imageData,
            hoverCanvas,
            regionCanvas,
            removeCanvas,
            mode: this.options.mode || 'add',
            bounds: {
              x: 0,
              y: 0,
              width: img.width,
              height: img.height,
            },
          };

          this.calculateWhitePixelCount(maskRegion);
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

  public getMaskRegionsSize(): number {
    return this.maskRegions?.length ?? 0;
  }

  public async applyInitialMask(
    maskId: string,
    imageObject: ImageObject,
    needHistory = false,
    isReset = false,
    texts: string[] = [],
  ): Promise<void> {
    const mask = this.maskRegions.find(mask => mask.id === maskId);
    if (!mask) return;

    if (texts.length) {
      const othersMask = this.maskRegions.filter(item => item.id !== maskId);
      const ids: string[] = [];

      // ⚡ 使用 Worker 进行像素重叠检测
      const promises = [];
      for (const item of othersMask) {
        promises.push(this.detectPixelOverlapAsync(mask.regionCanvas, item.regionCanvas));
      }
      const results = await Promise.all(promises);
      for (let i = 0; i < results.length; i++) {
        if (results[i]) {
          ids.push(othersMask[i].id);
        }
      }
      console.log('=> detect ids', ids);
      // const ids = texts;

      for (const id of ids) {
        this.appliedRegions.add(this.genRegionKey(imageObject.id, id));
      }

      this.appliedRegions.add(this.genRegionKey(imageObject.id, mask.id));
      this.initialAppliedRegions = new Set(this.appliedRegions);
    } else {
      this.appliedRegions = new Set(this.initialAppliedRegions);
    }

    if (!isReset) {
      this.applyMask(mask, imageObject, needHistory);
    } else if (isReset && needHistory) {
      const maskCanvas = (imageObject as any).maskCanvas as HTMLCanvasElement;
      const maskCtx = maskCanvas.getContext('2d')!;
      if (!maskCtx) return;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.save();
      maskCtx.drawImage(mask.regionCanvas, 0, 0);
      maskCtx.restore();
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Applied mask region`, true);
      this.editor.emit(EditorEvents.MASK_REGION_APPLIED, {
        region: mask,
        canvas: imageObject.maskCanvas,
        needHistory,
      });
      this.editor.requestRender();
    }

    // const imageDataList = this.maskRegions
    //   .map(item => {
    //     if (item.id !== maskId) {
    //       return { data: item.maskImageData, id: item.id };
    //     } else {
    //       return undefined;
    //     }
    //   })
    //   .filter(Boolean);
    // console.log('imageDataList', imageDataList);
    // if (imageDataList.length) {
    //   const imageDatas = imageDataList.map(item => item && item.data);
    //   if (imageDatas.length) {
    //     const result = processSegmentationWithBackground(imageDatas as ImageData[]);
    //     const indexs = result.idxs;
    //     indexs.forEach(idx => {
    //       if (imageDataList[idx] && imageDataList[idx].id) {
    //         this.appliedRegions.add(this.genRegionKey(imageObject.id, imageDataList[idx].id));
    //       }
    //     });
    //   }
    // }
    this.editor.history?.setInitialState(this.editor.getState());
  }

  public async setInitialAppliedRegions() {
    const objs = this.editor.objectManager.getAllObjects();
    if (objs && objs.length && this.maskRegions.length) {
      this.appliedRegions = new Set();
      const obj = objs[0] as ImageObject;
      if (obj) {
        const maskCanvas = obj.maskCanvas;
        if (!maskCanvas) return;
        const promises = [];
        for (let i = 0; i < this.maskRegions.length; i++) {
          promises.push(this.detectPixelOverlapAsync(maskCanvas, this.maskRegions[i].regionCanvas));
        }
        const results = await Promise.all(promises);
        for (let i = 0; i < results.length; i++) {
          if (results[i]) {
            this.appliedRegions.add(this.genRegionKey(obj.id, this.maskRegions[i].id));
          }
        }
      }
      this.initialAppliedRegions = new Set(this.appliedRegions);
    }
  }

  public setAppliedRegions(imageObject: ImageObject, ids: string[]): void {
    this.appliedRegions = new Set(ids.map(id => this.genRegionKey(imageObject.id, id)));
    this.initialAppliedRegions = new Set(this.appliedRegions);
  }

  public setMode(mode: 'add' | 'remove'): void {
    this.options.mode = mode;
  }

  public getMode(): 'add' | 'remove' {
    return this.options.mode || 'add';
  }

  getMaskRegions(): MaskRegion[] {
    return this.maskRegions;
  }
}
