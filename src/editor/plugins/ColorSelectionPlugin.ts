// 颜色选区插件 - 通过圆形选区和洪水算法进行颜色选择
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import type { Plugin, Point } from '../types';
import { EditorEvents, EditorHooks, EditorTools } from '../types';
import { hexToRgb } from '../utils/math';

export interface ColorSelectionPluginOptions {
  enabled?: boolean;
  tolerance?: number; // 颜色容差值
  selectionColor?: string; // 选区显示颜色
  selectionOpacity?: number; // 选区透明度
  mode?: 'add' | 'remove'; // 添加或去除选区模式
  color?: string; // 选区颜色
  opacity?: number; // 选区透明度
  continuous?: boolean; // 是否连续
  colorSelectionCursor?: string; // 颜色选区光标
  pickAddIcon?: string; // 添加选区图标
  pickRemoveIcon?: string; // 移除选区图标
}

export class ColorSelectionPlugin implements Plugin<Editor> {
  name = 'colorSelection';
  version = '1.0.0';

  private editor!: Editor;
  private options: ColorSelectionPluginOptions;

  // 选区状态
  private isSelecting: boolean = false;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private currentImageObject: ImageObject | null = null;

  // 性能优化：限制重渲染频率
  private lastRenderTime: number = 0;
  private renderDelay: number = 16; // 约60fps

  // 选区结果
  private selectionMask: Uint8Array | null = null;
  private selectionMaskImageObject: ImageObject | null = null; // 跟踪selectionMask属于哪个图像对象

  // 实时预览与缓存
  private rafId: number | null = null;
  private liveComputePending: boolean = false;
  private lastPreviewParams: { cx: number; cy: number; r: number; tolerance: number } | null = null;
  private lowResCache: WeakMap<
    ImageObject,
    {
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      imageData: ImageData;
      scaleX: number;
      scaleY: number;
      originalScale: number;
      actualWidth: number;
      actualHeight: number;
    }
  > = new WeakMap();
  private fullImageDataCache: WeakMap<ImageObject, ImageData> = new WeakMap();
  private previewMaskBuffer: Uint8Array | null = null;
  private maxPreviewDim: number = 288; // 低分辨率实时预览上限尺寸，平衡速度与质量

  // Worker 支持
  private worker: Worker | null = null;
  private workerJobId = 1;
  private pendingPreviewJobId: number | null = null;
  private pendingFinalJobId: number | null = null;
  private pendingFinalTarget: ImageObject | null = null;
  private tempRenderMaskCanvas?: HTMLCanvasElement | null = null;

  // 添加新的属性来保存拖动开始时的已确认选区状态
  private baseSelectionMask: Uint8Array | null = null; // 拖动开始时的已确认选区
  private baseSelectionWidth = 0;
  private baseSelectionHeight = 0;

  private selectionCanvas: HTMLCanvasElement | null = null;
  private selectionCtx: CanvasRenderingContext2D | null = null;
  private previewMaskWidth: number = 0;
  private previewMaskHeight: number = 0;

  // 渲染钩子引用，便于移除
  private drawHook = (ctx: CanvasRenderingContext2D) => this.drawCircleSelection(ctx);

  constructor(options: ColorSelectionPluginOptions = {}) {
    this.options = {
      enabled: true,
      tolerance: 32,
      selectionColor: '#00FF00',
      selectionOpacity: 0.5, // 调整为与 MaskBrushPlugin 一致的透明度
      mode: 'add',
      continuous: true,
      colorSelectionCursor: options?.colorSelectionCursor ?? 'crosshair',
      pickAddIcon: options?.pickAddIcon ?? 'crosshair',
      pickRemoveIcon: options?.pickRemoveIcon ?? 'crosshair',
      ...options,
    };
  }

  setContinuous(continuous: boolean): void {
    this.options.continuous = continuous;
  }

  private async initializeWorker(): Promise<void> {
    try {
      // 使用动态导入和 ?worker 后缀
      const { default: ColorSelectionWorker } = await import(
        './workers/colorSelectionWorker.ts?worker'
      );
      this.worker = new ColorSelectionWorker();
      this.worker.onmessage = this.onWorkerMessage;
      console.log('ColorSelection Worker initialized successfully');
    } catch (error) {
      console.warn(
        'Failed to initialize ColorSelection Worker, falling back to main thread:',
        error,
      );
      this.worker = null;
    }
  }

  install(editor: Editor): void {
    this.editor = editor;

    // 注册鼠标事件钩子
    this.registerEventHooks();

    // 注册渲染钩子，用于绘制实时圆形选区
    this.editor.hooks.after(EditorHooks.RENDER_AFTER, this.drawHook);

    this.initializeWorker();
    // try {
    //   // @ts-ignore - 构建工具需支持 Worker bundling
    //   const url = new URL('./workers/colorSelectionWorker.ts', import.meta.url);
    //   this.worker = new Worker(url, { type: 'module' });
    //   this.worker.onmessage = this.onWorkerMessage;
    // } catch {
    //   this.worker = null; // 不支持则回退主线程
    // }
  }

  uninstall(editor: Editor): void {
    this.unregisterEventHooks();
    this.clearSelection();

    editor.hooks.removeHook(EditorHooks.RENDER_AFTER, this.drawHook, 'after');

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private registerEventHooks(): void {
    // 注册鼠标事件钩子
    this.editor.hooks.before(EditorHooks.MOUSE_DOWN, this.onMouseDown);
    this.editor.hooks.before(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.before(EditorHooks.MOUSE_UP, this.onMouseUp);
    this.editor.hooks.before(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.on(EditorEvents.TOOL_CHANGED, this.toolChanged);
  }

  private unregisterEventHooks(): void {
    // 移除鼠标事件钩子
    this.editor.hooks.removeHook(EditorHooks.MOUSE_DOWN, this.onMouseDown);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_MOVE, this.onMouseMove);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_UP, this.onMouseUp);
    this.editor.hooks.removeHook(EditorHooks.MOUSE_LEAVE, this.onMouseLeave);
    this.editor.off(EditorEvents.TOOL_CHANGED, this.toolChanged);
  }

  private toolChanged = () => {
    if (this.editor.getTool() === EditorTools.COLOR_SELECTION) {
      this.editor.updateCanvasCursor(
        this.options.mode === 'add'
          ? (this.options.pickAddIcon ?? 'crosshair')
          : (this.options.pickRemoveIcon ?? 'crosshair'),
      );
    }
  };

  private onMouseDown = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.disableAllTools || this.editor.getSpacePressed()) return;
    if (!this.options.enabled || this.editor.getTool() !== EditorTools.COLOR_SELECTION) {
      return; // 未处理事件，继续默认行为
    }

    // 只处理左键点击
    if (event.button !== 0) {
      return; // 未处理事件，继续默认行为
    }

    const hitObject = this.editor.getObjectAt(worldPoint);

    if (hitObject && hitObject instanceof ImageObject) {
      this.isSelecting = true;
      this.startPoint = worldPoint;
      this.currentPoint = worldPoint;
      this.currentImageObject = hitObject;

      // 关键修改：保存拖动开始时的已确认选区状态
      this.saveBaseSelection(hitObject);

      // 取消正在进行的任务，但不清除现有选区
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.liveComputePending = false;
      }
      this.pendingPreviewJobId = null;
      this.pendingFinalJobId = null;
      this.pendingFinalTarget = null;
      this.ensureImageHasMask(hitObject);

      // 准备低分辨率缓存以便拖动实时预览
      this.prepareLowResCache(hitObject);

      event.preventDefault();
      event.stopPropagation();
      return true; // 已处理事件，阻止默认行为
    }

    // 没有命中图像对象，继续默认行为
  };

  private onMouseMove = (worldPoint: Point, event: MouseEvent) => {
    if (this.editor.disableAllTools || this.editor.getSpacePressed()) return;
    if (this.editor.getTool() === EditorTools.COLOR_SELECTION) {
      const icon =
        this.options.mode === 'add' ? this.options.pickAddIcon : this.options.pickRemoveIcon;
      this.editor.updateCanvasCursor(icon ?? 'crosshair', undefined, false);
    }
    if (!this.isSelecting || !this.startPoint || !this.currentImageObject) {
      return; // 未处理事件，继续默认行为
    }

    this.currentPoint = worldPoint;

    // 计划一次实时预览计算（使用 RAF 合并多次触发）
    this.scheduleLivePreview();

    // 仍保留渲染请求以绘制圆形提示（可选）
    const now = performance.now();
    if (now - this.lastRenderTime > this.renderDelay) {
      this.editor.requestRender();
      this.lastRenderTime = now;
    }

    event.preventDefault();
    return true; // 已处理事件，阻止默认行为
  };

  private onMouseUp = (_worldPoint: Point, _event: MouseEvent) => {
    if (this.isSelecting && this.startPoint && this.currentPoint && this.currentImageObject) {
      // 停止未完成的实时计算
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.liveComputePending = false;
      }

      this.previewMaskBuffer = null;
      this.previewMaskWidth = 0;
      this.previewMaskHeight = 0;
      this.clearSelectionCanvas();

      // 鼠标抬起时执行一次高分辨率颜色选择，替换预览
      this.performColorSelection();

      // 触发选择完成事件（预先发出，最终结果异步到达）
      this.editor.emit(EditorEvents.COLOR_SELECTION_COMPLETED, {
        imageObject: this.currentImageObject,
        tolerance: this.options.tolerance,
      });

      // 停止交互，但保留预览画面，等待最终结果到达
      this.isSelecting = false;
      this.startPoint = null;
      this.currentPoint = null;
      // 注意：currentImageObject 置空以停止命中测试；final 会写入 pendingFinalTarget
      this.currentImageObject = null;
      this.lastPreviewParams = null;
      this.pendingPreviewJobId = null;

      // 清理基础选区缓存
      this.baseSelectionMask = null;
      this.baseSelectionWidth = 0;
      this.baseSelectionHeight = 0;

      return true; // 已处理事件，阻止默认行为
    }
  };

  private onMouseLeave = (worldPoint: Point, event: MouseEvent) => {
    if (this.isSelecting) {
      // 调用onMouseUp来清理状态
      return this.onMouseUp(worldPoint, event);
    }
    // 未处理事件，继续默认行为
  };

  private onWorkerMessage = (e: MessageEvent<any>) => {
    const data = e.data;
    if (!data || data.kind !== 'flood:result') return;

    // 仅处理最新任务结果
    if (data.task === 'preview' && data.jobId !== this.pendingPreviewJobId) return;
    if (data.task === 'final' && data.jobId !== this.pendingFinalJobId) return;

    const mask: Uint8Array = data.mask;
    const width: number = data.width;
    const height: number = data.height;

    // 若最终结果为空掩码，则保留现有预览，不覆盖
    const hasAny = mask && mask.some ? mask.some(v => v > 0) : hasAnyByte(mask);

    if (data.task === 'preview') {
      if (!hasAny) return; // 预览空则跳过

      this.previewMaskBuffer = mask;
      this.previewMaskWidth = width;
      this.previewMaskHeight = height;
      // 创建预览显示，合并已有选区
      if (this.currentImageObject) {
        this.createPreviewSelectionDisplay(mask, width, height, this.currentImageObject);
        this.editor.requestRender();
      }
    } else {
      if (!hasAny) {
        // 最终空掩码：不覆盖预览，直接结束
        this.pendingFinalTarget = null;
        this.pendingFinalJobId = null;
        return;
      }
      // 检查是否需要合并现有选区
      let finalMask: Uint8Array;
      const target = this.pendingFinalTarget;
      const hasGlobalSelection =
        this.selectionMask &&
        this.selectionMask.length === mask.length &&
        this.selectionMaskImageObject === target;
      const existingMaskData = target ? target.getMaskData() : null;

      if (hasGlobalSelection) {
        // 有全局选区，直接合并
        finalMask = this.mergeMasks(this.selectionMask!, mask);
      } else if (existingMaskData) {
        // 没有全局选区，但图像对象有现有选区，需要提取并合并
        let existingMask = this.extractMaskFromImageData(existingMaskData);

        // 如果分辨率不同，需要缩放现有选区到当前分辨率
        if (existingMaskData.width !== width || existingMaskData.height !== height) {
          existingMask = this.upscaleMask(
            existingMask,
            existingMaskData.width,
            existingMaskData.height,
            width,
            height,
          );
        }

        finalMask = this.mergeMasks(existingMask, mask);
      } else if (this.options.mode === 'remove') {
        // Remove模式下，如果既没有全局选区也没有图像对象选区，则不创建选区
        this.pendingFinalTarget = null;
        this.pendingFinalJobId = null;
        return;
      } else {
        // Add模式下，使用新选区
        finalMask = mask;
      }

      // 使用 ImageObject 的 maskCanvas 系统
      if (target) {
        this.createSelectionCanvasFromMask(finalMask, width, height, target);
      }
      // 同步内部 selectionMask 供外部获取
      this.selectionMask = finalMask;
      this.selectionMaskImageObject = target;
      // 完成后清空
      this.pendingFinalTarget = null;
      this.pendingFinalJobId = null;
      this.editor.requestRender();
    }

    function hasAnyByte(arr: Uint8Array): boolean {
      for (let i = 0; i < arr.length; i++) if (arr[i] > 0) return true;
      return false;
    }
  };

  // 实时预览：优先用 worker 在低分辨率上计算
  private scheduleLivePreview(): void {
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || !this.currentImageObject)
      return;
    if (this.liveComputePending) return;

    this.liveComputePending = true;
    this.rafId = requestAnimationFrame(() => {
      this.liveComputePending = false;
      try {
        if (this.worker) {
          this.computeLivePreviewWithWorker();
        } else {
          this.computeLivePreview();
        }
      } catch (err) {
        console.error('computeLivePreview error:', err);
      }
    });
  }

  private prepareLowResCache(imageObj: ImageObject): void {
    const cached = this.lowResCache.get(imageObj);
    const maxDim = this.maxPreviewDim;

    const width = imageObj.width;
    const height = imageObj.height;

    // 宽高若未初始化（图片未加载），则跳过
    if (!width || !height) return;

    const scale = Math.min(1, maxDim / Math.max(width, height));
    const lowW = Math.max(1, Math.round(width * scale));
    const lowH = Math.max(1, Math.round(height * scale));

    if (cached && cached.canvas.width === lowW && cached.canvas.height === lowH) {
      return; // 已有可用缓存
    }

    const canvas = document.createElement('canvas');
    canvas.width = lowW;
    canvas.height = lowH;
    const ctx = canvas.getContext('2d')!;

    // 将原图绘制到低分辨率画布
    ctx.drawImage(imageObj.getImage(), 0, 0, lowW, lowH);
    const imageData = ctx.getImageData(0, 0, lowW, lowH);

    // 使用精确的缩放比例，而不是四舍五入后重新计算的比例
    // 这样可以确保坐标转换的一致性
    this.lowResCache.set(imageObj, {
      canvas,
      ctx,
      imageData,
      scaleX: lowW / width, // 保持原有计算方式，但添加精度补偿
      scaleY: lowH / height,
      // 添加原始缩放比例，用于更精确的计算
      originalScale: scale,
      actualWidth: lowW,
      actualHeight: lowH,
    });
  }

  private computeLivePreviewWithWorker(): void {
    if (
      !this.isSelecting ||
      !this.startPoint ||
      !this.currentPoint ||
      !this.currentImageObject ||
      !this.worker
    )
      return;
    const ready = this.lowResCache.get(this.currentImageObject);
    if (!ready) return;

    const { imageData, actualWidth, actualHeight } = ready;

    // 计算当前半径
    const worldRadius = Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) +
        Math.pow(this.currentPoint.y - this.startPoint.y, 2),
    );

    const localStart = this.worldToImageLocal(this.startPoint, this.currentImageObject);
    const scaleX = actualWidth / this.currentImageObject.width;
    const scaleY = actualHeight / this.currentImageObject.height;
    const centerLow = {
      x: localStart.x * scaleX,
      y: localStart.y * scaleY,
    };

    const localRadius =
      worldRadius /
      Math.min(this.currentImageObject.transform.scaleX, this.currentImageObject.transform.scaleY);
    const radiusLow = localRadius * Math.min(scaleX, scaleY);

    // 修改：使用圆半径作为 tolerance
    const tol = Math.round(radiusLow); // 将低分辨率半径作为容差

    // 关键修改：检测半径显著变小的情况
    let shouldForceUpdate = false;
    if (this.lastPreviewParams) {
      const dx = this.lastPreviewParams.cx - centerLow.x;
      const dy = this.lastPreviewParams.cy - centerLow.y;
      const dr = this.lastPreviewParams.r - radiusLow;

      // 如果半径显著变小（超过20%），强制更新
      if (dr > this.lastPreviewParams.r * 0.2) {
        shouldForceUpdate = true;
        // 先清除当前的预览显示，只保留已确认的mask
        this.clearCurrentPreview();
      }

      if (
        Math.abs(dx) < 0.75 &&
        Math.abs(dy) < 0.75 &&
        Math.abs(dr) < 0.75 &&
        this.lastPreviewParams.tolerance === tol &&
        !shouldForceUpdate
      ) {
        return;
      }
    }

    const jobId = ++this.workerJobId;
    this.pendingPreviewJobId = jobId;

    // 收集预览种子点（像素坐标）
    let seedPointsLow = this.getCircleSeedPointsInPixels(
      centerLow,
      radiusLow,
      imageData.width,
      imageData.height,
    );
    if (seedPointsLow.length === 0) {
      // 兜底：取圆心四舍五入到最近像素
      const x = Math.max(0, Math.min(imageData.width - 1, Math.round(centerLow.x)));
      const y = Math.max(0, Math.min(imageData.height - 1, Math.round(centerLow.y)));
      seedPointsLow = [{ x, y }];
    }

    // 将数据发送到 worker
    const msg = {
      kind: 'flood',
      jobId,
      task: 'preview',
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
      seedPoints: seedPointsLow,
      tolerance: tol, // 使用圆半径作为容差
      continuous: this.options.continuous,
    } as const;

    try {
      this.worker.postMessage(msg);
      this.lastPreviewParams = { cx: centerLow.x, cy: centerLow.y, r: radiusLow, tolerance: tol };
    } catch {
      // Worker 通信失败，回退主线程
      this.computeLivePreview();
    }
  }

  private computeLivePreview(): void {
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || !this.currentImageObject)
      return;

    const ready = this.lowResCache.get(this.currentImageObject);
    if (!ready) {
      // 若未准备好缓存，尝试准备一次
      this.prepareLowResCache(this.currentImageObject);
    }
    const cache = this.lowResCache.get(this.currentImageObject);
    if (!cache) return;

    const { imageData, actualWidth, actualHeight } = cache;

    // 使用与最终选区一致的半径计算方式（世界坐标半径）
    const worldRadius = Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) +
        Math.pow(this.currentPoint.y - this.startPoint.y, 2),
    );

    const localStart = this.worldToImageLocal(this.startPoint, this.currentImageObject);

    // 直接使用实际缩放比例，避免复杂计算
    const scaleX = actualWidth / this.currentImageObject.width;
    const scaleY = actualHeight / this.currentImageObject.height;
    const centerLow = {
      x: localStart.x * scaleX,
      y: localStart.y * scaleY,
    };

    // 统一的半径转换：世界坐标半径 -> 图像本地半径 -> 低分辨率半径
    const localRadius =
      worldRadius /
      Math.min(this.currentImageObject.transform.scaleX, this.currentImageObject.transform.scaleY);
    const radiusLow = localRadius * Math.min(scaleX, scaleY);

    // 距离变化/容差未变动时跳过昂贵计算
    // 修改：使用圆半径作为容差
    const tol = Math.round(radiusLow);
    if (this.lastPreviewParams) {
      const dx = this.lastPreviewParams.cx - centerLow.x;
      const dy = this.lastPreviewParams.cy - centerLow.y;
      const dr = this.lastPreviewParams.r - radiusLow;
      if (
        Math.abs(dx) < 0.75 &&
        Math.abs(dy) < 0.75 &&
        Math.abs(dr) < 0.75 &&
        this.lastPreviewParams.tolerance === tol
      ) {
        return;
      }
    }

    // 生成低分辨率圆形区域内的种子点（像素坐标系）
    let seedPointsLow = this.getCircleSeedPointsInPixels(
      centerLow,
      radiusLow,
      imageData.width,
      imageData.height,
    );
    if (seedPointsLow.length === 0) {
      const x = Math.max(0, Math.min(imageData.width - 1, Math.round(centerLow.x)));
      const y = Math.max(0, Math.min(imageData.height - 1, Math.round(centerLow.y)));
      seedPointsLow = [{ x, y }];
    }

    // 在低分辨率 imageData 上执行洪水填充，使用圆半径作为容差
    const lowResMask = this.floodFill(imageData, seedPointsLow, tol);

    // 记录参数，用于后续跳过
    this.lastPreviewParams = { cx: centerLow.x, cy: centerLow.y, r: radiusLow, tolerance: tol };

    // 创建预览显示，合并已有选区
    if (this.currentImageObject) {
      this.createPreviewSelectionDisplay(
        lowResMask,
        imageData.width,
        imageData.height,
        this.currentImageObject,
      );
    }

    this.editor.requestRender();
  }

  private drawCircleSelection(ctx: CanvasRenderingContext2D): void {
    // 只有在正在选择且工具激活时才绘制
    if (
      !this.isSelecting ||
      !this.startPoint ||
      !this.currentPoint ||
      !this.options.enabled ||
      this.editor.getTool() !== 'colorSelection'
    ) {
      return;
    }

    // 重要：在render:after钩子中，context已经应用了viewport变换
    // 我们需要重置变换矩阵，使用原始的屏幕坐标系
    ctx.save();

    // 重置为单位矩阵，但保持DPR缩放
    const devicePixelRatio = window.devicePixelRatio || 1;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // 将世界坐标转换到屏幕坐标
    const viewportStart = this.editor.viewport.worldToScreen(this.startPoint);
    const viewportCurrent = this.editor.viewport.worldToScreen(this.currentPoint);

    // 在屏幕坐标中计算半径，确保准确性
    const viewportRadius = Math.sqrt(
      Math.pow(viewportCurrent.x - viewportStart.x, 2) +
        Math.pow(viewportCurrent.y - viewportStart.y, 2),
    );

    // 使用屏幕坐标绘制
    const viewportCenter = viewportStart;

    this.drawCircleSelectionStyle(ctx, viewportCenter, viewportRadius);

    // 恢复原来的变换矩阵
    ctx.restore();
  }

  /**
   * 绘制圆形选区
   */
  private drawCircleSelectionStyle(
    ctx: CanvasRenderingContext2D,
    center: { x: number; y: number },
    radius: number,
  ): void {
    ctx.save();

    // 外围细边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 1, 0, Math.PI * 2);
    ctx.stroke();

    // 内围细边框
    ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    ctx.lineWidth = 0.5;

    ctx.beginPath();
    ctx.fillStyle = 'rgba(18, 23, 35, 0.1)';
    ctx.arc(center.x, center.y, Math.abs(radius - 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 新增：绘制容差文本
    if (this.currentImageObject) {
      // 计算世界坐标半径
      const worldRadius = Math.sqrt(
        Math.pow(this.currentPoint!.x - this.startPoint!.x, 2) +
          Math.pow(this.currentPoint!.y - this.startPoint!.y, 2),
      );

      // 转换为本地半径
      const localRadius =
        worldRadius /
        Math.min(
          this.currentImageObject.transform.scaleX,
          this.currentImageObject.transform.scaleY,
        );

      // 计算容差（使用本地半径作为容差）
      const tolerance = Math.round(localRadius);

      // 计算容差百分比（基于 0-255 的范围）
      const tolerancePercent = Math.round((tolerance / 255) * 100);

      // 绘制文本背景
      const text = `Tolerance: ${tolerancePercent}%`;
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textMetrics = ctx.measureText(text);
      const textWidth = textMetrics.width;
      const textHeight = 20;

      const screenPoint = this.editor.viewport.worldToScreen(this.currentPoint!);
      const offsetX = 30;
      const textX = screenPoint.x + offsetX; // 鼠标右侧
      const textY = screenPoint.y - textHeight / 2 - 5; // 鼠标上方

      // 绘制背景矩形
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(textX - 8, textY - textHeight + 4, textWidth + 16, textHeight);

      // 绘制文本
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(text, textX, textY - textHeight + 8);
    }

    ctx.restore();
  }

  private performColorSelection(): void {
    if (!this.startPoint || !this.currentPoint || !this.currentImageObject) return;

    // 检查是否有当前的实时预览结果
    const currentImageObj = this.currentImageObject;
    if (currentImageObj.hasMaskData()) {
      // 基于实时预览结果生成高分辨率版本，确保一致性
      this.upgradePreviewToHighRes();
      return;
    }

    // 如果没有预览结果，回退到原始逻辑（通常不会发生）
    this.performDirectColorSelection();
  }

  private upgradePreviewToHighRes(): void {
    if (!this.currentImageObject) return;

    // 获取低分辨率预览的蒙版数据
    const lowResImageData = this.currentImageObject.getMaskData();
    if (!lowResImageData) return;

    const lowResMask = this.extractMaskFromImageData(lowResImageData);

    // 获取高分辨率图像数据
    const highResImageData = this.getImageDataCached(this.currentImageObject);
    if (!highResImageData) return;

    // 映射低分辨率蒙版到高分辨率
    const highResMask = this.upscaleMask(
      lowResMask,
      lowResImageData.width,
      lowResImageData.height,
      highResImageData.width,
      highResImageData.height,
    );

    // 可选：在高分辨率上进行边缘细化
    const refinedMask = this.refineMaskEdges(highResMask, highResImageData);

    // refinedMask是从预览升级而来，预览阶段已经正确合并了所有现有选区
    // 所以这里直接使用refinedMask作为最终结果，不需要再次合并
    const finalMask = refinedMask;

    // 更新选区蒙版
    this.selectionMask = finalMask;
    this.selectionMaskImageObject = this.currentImageObject;

    // 创建高分辨率选区蒙版并应用
    this.createSelectionCanvasFromMask(
      finalMask,
      highResImageData.width,
      highResImageData.height,
      this.currentImageObject,
    );

    // 记录历史（插件影响对象）
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Color selection applied');

    this.editor.requestRender();
  }

  private performDirectColorSelection(): void {
    if (!this.startPoint || !this.currentPoint || !this.currentImageObject) return;

    // 计算世界坐标半径（与实时预览保持一致）
    const worldRadius = Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) +
        Math.pow(this.currentPoint.y - this.startPoint.y, 2),
    );

    // 获取图像数据（带缓存）
    const imageData = this.getImageDataCached(this.currentImageObject);
    if (!imageData) return;

    // 转换为图像本地坐标系
    const localStart = this.worldToImageLocal(this.startPoint, this.currentImageObject);
    const localRadius =
      worldRadius /
      Math.min(this.currentImageObject.transform.scaleX, this.currentImageObject.transform.scaleY);

    // 使用与实时预览一致的种子点生成方式
    let seedPoints = this.getCircleSeedPointsInPixels(
      localStart,
      localRadius,
      imageData.width,
      imageData.height,
    );
    if (seedPoints.length === 0) {
      // 兜底：取中心像素
      const x = Math.max(0, Math.min(imageData.width - 1, Math.round(localStart.x)));
      const y = Math.max(0, Math.min(imageData.height - 1, Math.round(localStart.y)));
      seedPoints = [{ x, y }];
    }

    // 修改：使用本地半径作为容差
    const tol = Math.round(localRadius);

    // 如果有 worker，优先使用高分辨率 worker 计算
    if (this.worker) {
      const jobId = ++this.workerJobId;
      this.pendingFinalJobId = jobId;
      this.pendingFinalTarget = this.currentImageObject; // 保存目标对象引用
      const msg = {
        kind: 'flood',
        jobId,
        task: 'final',
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
        seedPoints: seedPoints,
        tolerance: tol, // 使用本地半径作为容差
        continuous: this.options.continuous,
      } as const;
      try {
        this.worker.postMessage(msg);
        return; // 等待 worker 回调应用结果
      } catch {
        // Worker 通信失败，回退主线程
        this.pendingFinalTarget = null;
      }
    }

    // 主线程执行洪水算法（高分辨率）
    const newMask = this.floodFill(imageData, seedPoints, tol);

    // 若结果为空，保留当前预览，不覆盖
    const hasAny = newMask.some(v => v > 0);
    if (!hasAny) return;

    // 检查是否已有选区，如果有则合并
    const hasGlobalSelection =
      this.selectionMask &&
      this.selectionMask.length === newMask.length &&
      this.selectionMaskImageObject === this.currentImageObject;
    const existingMaskData = this.currentImageObject ? this.currentImageObject.getMaskData() : null;

    if (hasGlobalSelection) {
      // 有全局选区，直接合并
      this.selectionMask = this.mergeMasks(this.selectionMask!, newMask);
      this.selectionMaskImageObject = this.currentImageObject;
    } else if (existingMaskData) {
      // 没有全局选区，但图像对象有现有选区，需要提取并合并
      let existingMask = this.extractMaskFromImageData(existingMaskData);

      // 如果分辨率不同，需要缩放现有选区到当前分辨率
      if (
        existingMaskData.width !== imageData.width ||
        existingMaskData.height !== imageData.height
      ) {
        existingMask = this.upscaleMask(
          existingMask,
          existingMaskData.width,
          existingMaskData.height,
          imageData.width,
          imageData.height,
        );
      }

      this.selectionMask = this.mergeMasks(existingMask, newMask);
      this.selectionMaskImageObject = this.currentImageObject;
    } else if (this.options.mode === 'remove') {
      // Remove模式下，如果既没有全局选区也没有图像对象选区，则不创建选区
      return;
    } else {
      // Add模式下，使用新选区
      this.selectionMask = newMask;
      this.selectionMaskImageObject = this.currentImageObject;
    }

    // 创建选区蒙版并应用到图像对象（高分辨率）
    this.createSelectionMask();
    this.applySelectionToImage();
  }

  private getImageData(imageObj: ImageObject): ImageData | null {
    try {
      // 创建临时画布来获取图像数据
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;

      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;

      // 绘制图像到临时画布
      tempCtx.drawImage(imageObj.getImage(), 0, 0);

      return tempCtx.getImageData(0, 0, imageObj.width, imageObj.height);
    } catch (error) {
      console.error('Failed to get image data:', error);
      return null;
    }
  }

  private getImageDataCached(imageObj: ImageObject): ImageData | null {
    const cached = this.fullImageDataCache.get(imageObj);
    if (cached && cached.width === imageObj.width && cached.height === imageObj.height) {
      return cached;
    }
    const data = this.getImageData(imageObj);
    if (data) {
      this.fullImageDataCache.set(imageObj, data);
    }
    return data;
  }

  private floodFill(imageData: ImageData, seedPoints: Point[], tolerance: number): Uint8Array {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    const totalPixels = width * height;

    // 优化：预计算种子颜色数组，使用 TypedArray 存储
    const seedColorsR: number[] = [];
    const seedColorsG: number[] = [];
    const seedColorsB: number[] = [];
    const seedColorsA: number[] = []; // 保存 alpha 通道

    for (const seed of seedPoints) {
      const index = (seed.y * width + seed.x) * 4;
      if (index >= 0 && index < data.length) {
        seedColorsR.push(data[index]);
        seedColorsG.push(data[index + 1]);
        seedColorsB.push(data[index + 2]);
        seedColorsA.push(data[index + 3]);
      }
    }

    if (seedColorsR.length === 0) {
      return mask;
    }

    const tolSq = tolerance * tolerance;
    const seedCount = seedColorsR.length;

    // 优化：使用预分配数组队列，避免动态扩容
    // 估算最大队列大小（通常是图像面积的 10-30%）
    const estimatedQueueSize = Math.min(totalPixels, Math.floor(totalPixels * 0.3));
    const queueX = new Uint32Array(estimatedQueueSize);
    const queueY = new Uint32Array(estimatedQueueSize);
    let head = 0;
    let tail = 0;

    // 标记种子点为已访问
    for (const seed of seedPoints) {
      const maskIndex = seed.y * width + seed.x;
      if (maskIndex >= 0 && maskIndex < totalPixels) {
        visited[maskIndex] = 1;
        mask[maskIndex] = 255;
        if (tail < estimatedQueueSize) {
          queueX[tail] = seed.x;
          queueY[tail] = seed.y;
          tail++;
        }
      }
    }

    // 优化：内联 maybeVisit 函数，减少函数调用开销
    while (head < tail) {
      const cx = queueX[head];
      const cy = queueY[head];
      head++;

      // 四邻域检查
      const neighbors = [
        { x: cx - 1, y: cy },
        { x: cx + 1, y: cy },
        { x: cx, y: cy - 1 },
        { x: cx, y: cy + 1 },
      ];

      for (const neighbor of neighbors) {
        const px = neighbor.x;
        const py = neighbor.y;

        // 边界检查
        if (px < 0 || px >= width || py < 0 || py >= height) continue;

        const id = py * width + px;
        if (visited[id]) continue;

        const pi = id * 4;
        const pr = data[pi];
        const pg = data[pi + 1];
        const pb = data[pi + 2];
        const pa = data[pi + 3]; // 读取 alpha 通道

        // 优化：使用循环展开和提前退出
        let matched = false;
        for (let i = 0; i < seedCount; i++) {
          const dr = pr - seedColorsR[i];
          const dg = pg - seedColorsG[i];
          const db = pb - seedColorsB[i];
          const distSq = dr * dr + dg * dg + db * db;

          // 同时检查 alpha 通道的相似度
          const da = pa - seedColorsA[i];
          const alphaDistSq = da * da;

          // 综合考虑 RGB 和 Alpha 的距离
          // alpha 权重较低（0.1），主要还是基于颜色匹配
          if (distSq + alphaDistSq * 0.1 <= tolSq) {
            matched = true;
            break;
          }
        }

        if (matched) {
          visited[id] = 1;
          mask[id] = 255;
          if (tail < estimatedQueueSize) {
            queueX[tail] = px;
            queueY[tail] = py;
            tail++;
          }
        }
      }
    }

    return mask;
  }

  private createSelectionMask(): void {
    if (!this.selectionMask || !this.currentImageObject) return;

    const width = this.currentImageObject.width;
    const height = this.currentImageObject.height;
    // if (!this.tempRenderMaskCanvas) {
    //   this.tempRenderMaskCanvas = document.createElement('canvas');
    //   this.tempRenderMaskCanvas.width = width;
    //   this.tempRenderMaskCanvas.height = height;
    // }

    // 将蒙版数据转换为 ImageData，alpha 通道直接使用蒙版值（0-255），颜色通道使用白色
    const imageData = new ImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < this.selectionMask.length; i++) {
      const pixelIndex = i * 4;
      const maskValue = this.selectionMask[i];

      if (maskValue > 0) {
        // 设置选区颜色
        const color = hexToRgb('#ffffff');
        data[pixelIndex] = color.r; // R
        data[pixelIndex + 1] = color.g; // G
        data[pixelIndex + 2] = color.b; // B
        data[pixelIndex + 3] = maskValue; // 使用灰度 alpha，叠加透明度由 maskOpacity 控制
      } else {
        // 透明区域
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }

    // const tempCtx = this.tempRenderMaskCanvas.getContext('2d')!;
    // tempCtx.save();
    // tempCtx.putImageData(imageData, 0, 0);
    // tempCtx.restore();
    // 使用 ImageObject 的 maskCanvas 系统
    this.currentImageObject.setMaskData(imageData);
    // this.currentImageObject.setMaskColor(this.options.selectionColor || '#00FF00');
    // this.currentImageObject.setMaskOpacity(this.options.selectionOpacity || 0.5);
  }

  private createSelectionCanvasFromMask(
    mask: Uint8Array,
    width: number,
    height: number,
    targetImageObject?: ImageObject,
  ): void {
    const imageObject = targetImageObject || this.currentImageObject;
    if (!imageObject) return;

    // 获取图像对象的实际尺寸
    const actualWidth = imageObject.width;
    const actualHeight = imageObject.height;

    // 检查传入的蒙版尺寸是否与图像实际尺寸一致
    let finalMask = mask;
    let finalWidth = width;
    let finalHeight = height;

    if (width !== actualWidth || height !== actualHeight) {
      // 需要将蒙版缩放到图像的实际尺寸
      finalMask = this.upscaleMask(mask, width, height, actualWidth, actualHeight);
      finalWidth = actualWidth;
      finalHeight = actualHeight;
    }

    // 创建 ImageData，使用正确的尺寸
    const imageData = new ImageData(finalWidth, finalHeight);
    const data = imageData.data;

    const color = hexToRgb('#ffffff');

    for (let i = 0; i < finalMask.length; i++) {
      const pixelIndex = i * 4;
      const maskValue = finalMask[i];
      if (maskValue > 0) {
        data[pixelIndex] = color.r;
        data[pixelIndex + 1] = color.g;
        data[pixelIndex + 2] = color.b;
        data[pixelIndex + 3] = maskValue; // 使用灰度 alpha，叠加透明度由 maskOpacity 控制
      } else {
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }

    // 使用 ImageObject 的 maskCanvas 系统
    imageObject.setMaskData(imageData);

    this.editor.emit(EditorEvents.COLOR_SELECTION_UPDATED, {
      canvas: imageObject.maskCanvas,
    });
  }

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

      // // 设置初始mask属性
      imageObj.setMaskOpacity(this.options.opacity || 0.5);
      imageObj.setMaskColor(this.options.color || '#FF0000');
    }
  }

  private applySelectionToImage(): void {
    if (!this.currentImageObject) return;

    // 掩码数据已经通过 setMaskData 方法设置到 ImageObject 中
    // 只需要请求重渲染
    this.editor.requestRender();
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

  // 公共方法
  public enable(): void {
    this.options.enabled = true;
    this.editor.emit(EditorEvents.COLOR_SELECTION_ENABLED, {});
  }

  public disable(): void {
    this.options.enabled = false;
    this.isSelecting = false;
    this.startPoint = null;
    this.currentPoint = null;
    this.currentImageObject = null;
    // 取消 RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.liveComputePending = false;
    }
    // 中止 worker
    this.pendingPreviewJobId = null;
    this.pendingFinalJobId = null;
    this.pendingFinalTarget = null;
    this.editor.emit(EditorEvents.COLOR_SELECTION_DISABLED, {});
  }

  public setTolerance(tolerance: number): void {
    this.options.tolerance = Math.max(0, Math.min(255, tolerance));
    this.lastPreviewParams = null; // 容差改变，强制刷新
    this.editor.emit(EditorEvents.COLOR_SELECTION_TOLERANCE_CHANGED, {
      tolerance: this.options.tolerance,
    });
  }

  public setSelectionColor(color: string): void {
    this.options.selectionColor = color;
    this.editor.emit(EditorEvents.COLOR_SELECTION_COLOR_CHANGED, { color });
  }

  public setSelectionOpacity(opacity: number): void {
    this.options.selectionOpacity = Math.max(0, Math.min(1, opacity));
    this.editor.emit(EditorEvents.COLOR_SELECTION_OPACITY_CHANGED, {
      opacity: this.options.selectionOpacity,
    });
  }

  public setMode(mode: 'add' | 'remove'): void {
    this.options.mode = mode;
    this.editor.updateCanvasCursor(
      mode === 'add'
        ? (this.options.pickAddIcon ?? 'crosshair')
        : (this.options.pickRemoveIcon ?? 'crosshair'),
    );
    // 根据当前模式更新选区
    if (this.currentImageObject && this.previewMaskBuffer && this.isSelecting) {
      this.createPreviewSelectionDisplay(
        this.previewMaskBuffer,
        this.previewMaskWidth,
        this.previewMaskHeight,
        this.currentImageObject,
      );
      this.editor.requestRender();
    }
    this.editor.emit(EditorEvents.COLOR_SELECTION_MODE_CHANGED, { mode });
  }

  public clearSelection(): void {
    this.selectionMask = null;
    this.selectionMaskImageObject = null;

    // 清除所有图像对象的选区
    const objects = this.editor.objectManager.getAllObjects();
    objects.forEach((obj: any) => {
      if (obj instanceof ImageObject) {
        (obj as ImageObject).clearMask();

        // 清除 selectionCanvas
        const selectionCanvas = (obj as any).selectionCanvas as HTMLCanvasElement;
        if (selectionCanvas) {
          const ctx = selectionCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
          }
          (obj as any).hasSelection = false;
        }
      }
    });

    // 取消 RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.liveComputePending = false;
    }
    // 中止 worker 任务标记
    this.pendingPreviewJobId = null;
    this.pendingFinalJobId = null;
    this.pendingFinalTarget = null;

    this.editor.requestRender();
    this.editor.emit(EditorEvents.COLOR_SELECTION_CLEARED, {});
    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Color selection cleared');
  }

  public getSelectionMask(): Uint8Array | null {
    return this.selectionMask;
  }

  // 基于像素坐标的圆形区域采样（不做世界->本地转换）
  private getCircleSeedPointsInPixels(
    centerPx: Point,
    radiusPx: number,
    width: number,
    height: number,
    _imageData?: ImageData, // 保留参数以保持兼容性，但不再使用
  ): Point[] {
    const seedPoints: Point[] = [];
    const sampleStep = Math.max(1, Math.floor(radiusPx / 10));

    const minX = Math.max(0, Math.floor(centerPx.x - radiusPx));
    const maxX = Math.min(width - 1, Math.ceil(centerPx.x + radiusPx));
    const minY = Math.max(0, Math.floor(centerPx.y - radiusPx));
    const maxY = Math.min(height - 1, Math.ceil(centerPx.y + radiusPx));

    for (let x = minX; x <= maxX; x += sampleStep) {
      for (let y = minY; y <= maxY; y += sampleStep) {
        const dx = x - centerPx.x;
        const dy = y - centerPx.y;
        if (dx * dx + dy * dy <= radiusPx * radiusPx) {
          seedPoints.push({ x, y });
        }
      }
    }
    return seedPoints;
  }

  // 从ImageData中提取蒙版数据（优化版）
  private extractMaskFromImageData(imageData: ImageData): Uint8Array {
    const data = imageData.data;
    const mask = new Uint8Array(imageData.width * imageData.height);
    const length = mask.length;

    // 优化：直接遍历，减少索引计算
    for (let i = 0; i < length; i++) {
      mask[i] = data[i * 4 + 3]; // alpha通道
    }

    return mask;
  }

  // 优化的蒙版缩放方法：根据缩放比例选择算法
  private scaleMask(
    sourceMask: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Uint8Array {
    const targetMask = new Uint8Array(targetWidth * targetHeight);

    if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
      targetMask.set(sourceMask);
      return targetMask;
    }

    const scaleX = sourceWidth / targetWidth;
    const scaleY = sourceHeight / targetHeight;
    const scaleRatio = Math.max(scaleX, scaleY);

    // 优化：大图像或大比例缩放时使用最近邻插值（更快）
    // 小比例缩放时使用双线性插值（质量更好）
    if (scaleRatio > 2 || targetWidth * targetHeight > 4000000) {
      // 使用最近邻插值（更快）
      for (let ty = 0; ty < targetHeight; ty++) {
        const sy = Math.floor(ty * scaleY);
        const y = Math.min(sourceHeight - 1, sy);
        const rowOffset = y * sourceWidth;
        const targetRowOffset = ty * targetWidth;

        for (let tx = 0; tx < targetWidth; tx++) {
          const sx = Math.floor(tx * scaleX);
          const x = Math.min(sourceWidth - 1, sx);
          targetMask[targetRowOffset + tx] = sourceMask[rowOffset + x];
        }
      }
    } else {
      // 使用双线性插值（质量更好）
      const scaleX = sourceWidth / targetWidth;
      const scaleY = sourceHeight / targetHeight;

      for (let ty = 0; ty < targetHeight; ty++) {
        const sy = (ty + 0.5) * scaleY - 0.5;
        const y0 = Math.max(0, Math.floor(sy));
        const y1 = Math.min(sourceHeight - 1, y0 + 1);
        const wy = sy - y0;
        const y0Offset = y0 * sourceWidth;
        const y1Offset = y1 * sourceWidth;
        const targetRowOffset = ty * targetWidth;

        for (let tx = 0; tx < targetWidth; tx++) {
          const sx = (tx + 0.5) * scaleX - 0.5;
          const x0 = Math.max(0, Math.floor(sx));
          const x1 = Math.min(sourceWidth - 1, x0 + 1);
          const wx = sx - x0;

          const v00 = sourceMask[y0Offset + x0];
          const v10 = sourceMask[y0Offset + x1];
          const v01 = sourceMask[y1Offset + x0];
          const v11 = sourceMask[y1Offset + x1];

          const v0 = v00 * (1 - wx) + v10 * wx;
          const v1 = v01 * (1 - wx) + v11 * wx;
          const v = v0 * (1 - wy) + v1 * wy;

          targetMask[targetRowOffset + tx] = Math.max(0, Math.min(255, Math.round(v)));
        }
      }
    }

    return targetMask;
  }

  // 将低分辨率蒙版升级到高分辨率
  private upscaleMask(
    lowResMask: Uint8Array,
    lowWidth: number,
    lowHeight: number,
    highWidth: number,
    highHeight: number,
  ): Uint8Array {
    return this.scaleMask(lowResMask, lowWidth, lowHeight, highWidth, highHeight);
  }

  // 在高分辨率上细化蒙版边缘（可选优化）
  private refineMaskEdges(mask: Uint8Array, _imageData: ImageData): Uint8Array {
    // 目前返回原始蒙版，后续可以添加边缘细化算法
    // 可以实现：边缘平滑、基于颜色相似度的边缘扩展等
    return mask;
  }

  // 优化的合并蒙版：减少条件判断
  private mergeMasks(existingMask: Uint8Array, newMask: Uint8Array): Uint8Array {
    if (existingMask.length !== newMask.length) {
      return newMask;
    }

    const mergedMask = new Uint8Array(existingMask.length);
    const isAddMode = this.options.mode === 'add';

    // 优化：分离两种模式，避免循环内条件判断
    if (isAddMode) {
      // Add 模式：使用 max 保留软边
      for (let i = 0; i < existingMask.length; i++) {
        const a = existingMask[i];
        const b = newMask[i];
        mergedMask[i] = a > b ? a : b;
      }
    } else {
      // Remove 模式：按灰度相减
      for (let i = 0; i < existingMask.length; i++) {
        const a = existingMask[i];
        const b = newMask[i];
        mergedMask[i] = a > b ? a - b : 0;
      }
    }

    return mergedMask;
  }

  // 创建预览选区的显示，如果有已存在的选区则合并显示
  private createPreviewSelectionDisplay(
    previewMask: Uint8Array,
    width: number,
    height: number,
    imageObj: ImageObject,
  ): void {
    // 始终在图像的原始高分辨率上进行预览计算和显示
    const imageWidth = imageObj.width;
    const imageHeight = imageObj.height;

    let displayMask: Uint8Array;

    // 在remove模式下，如果没有基础选区，则不显示任何内容
    if (this.options.mode === 'remove' && !this.baseSelectionMask) {
      return;
    }

    // 关键修改：只与拖动开始时的基础选区合并，而不是当前的mask状态
    if (this.baseSelectionMask) {
      // 确保预览mask是高分辨率的
      let highResPreviewMask = previewMask;
      if (width !== imageWidth || height !== imageHeight) {
        highResPreviewMask = this.upscaleMask(previewMask, width, height, imageWidth, imageHeight);
      }

      // 使用原始高分辨率的基础选区
      displayMask = this.mergeMasks(this.baseSelectionMask, highResPreviewMask);

      // 在 remove 模式下，计算并显示红色预览
      if (this.options.mode === 'remove') {
        // 计算将被移除的区域（baseMask 和 previewMask 的重叠部分）
        const removeMask = new Uint8Array(this.baseSelectionMask.length);
        for (let i = 0; i < this.baseSelectionMask.length; i++) {
          if (this.baseSelectionMask[i] > 0 && highResPreviewMask[i] > 0) {
            removeMask[i] = 255; // 重叠部分将被移除
          } else {
            removeMask[i] = 0;
          }
        }

        // 初始化并绘制红色预览（使用高分辨率）
        this.initSelectionCanvas(imageObj);
        this.drawRemovalPreview(removeMask, imageWidth, imageHeight, imageObj);
      }
    } else {
      // 没有基础选区时，也确保预览mask是高分辨率的
      if (width !== imageWidth || height !== imageHeight) {
        displayMask = this.upscaleMask(previewMask, width, height, imageWidth, imageHeight);
      } else {
        displayMask = previewMask;
      }
    }

    // 创建用于显示的选区蒙版（始终使用高分辨率）
    this.createSelectionCanvasFromMask(displayMask, imageWidth, imageHeight, imageObj);
  }

  // 辅助方法：获取当前预览的世界坐标半径
  private getCurrentPreviewRadius(): number {
    if (!this.startPoint || !this.currentPoint) return 0;

    return Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) +
        Math.pow(this.currentPoint.y - this.startPoint.y, 2),
    );
  }

  // 新增方法：清除当前预览，只保留已确认的选区
  private clearCurrentPreview(): void {
    if (!this.currentImageObject) return;

    // 关键修改：恢复到拖动开始时的基础选区状态
    if (this.baseSelectionMask) {
      // 重新创建基础选区的显示
      this.createSelectionCanvasFromMask(
        this.baseSelectionMask,
        this.baseSelectionWidth,
        this.baseSelectionHeight,
        this.currentImageObject,
      );
    } else {
      // 如果没有基础选区，清空显示
      const canvas = this.currentImageObject.maskCanvas;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }

    this.editor.requestRender();
  }

  // 将高分辨率蒙版缩放到低分辨率
  private downscaleMask(
    highResMask: Uint8Array,
    highWidth: number,
    highHeight: number,
    lowWidth: number,
    lowHeight: number,
  ): Uint8Array {
    return this.scaleMask(highResMask, highWidth, highHeight, lowWidth, lowHeight);
  }

  // 新增：保存拖动开始时的已确认选区
  private saveBaseSelection(imageObj: ImageObject): void {
    const existingMaskData = imageObj.getMaskData();
    if (existingMaskData) {
      // 保存已确认的选区作为基础
      const existingMask = this.extractMaskFromImageData(existingMaskData);
      this.baseSelectionMask = new Uint8Array(existingMask);
      this.baseSelectionWidth = existingMaskData.width;
      this.baseSelectionHeight = existingMaskData.height;
    } else {
      // 没有已确认的选区
      this.baseSelectionMask = null;
      this.baseSelectionWidth = 0;
      this.baseSelectionHeight = 0;
    }
  }

  // 新增：初始化 selectionCanvas
  private initSelectionCanvas(imageObj: ImageObject): void {
    if (!this.selectionCanvas) {
      this.selectionCanvas = document.createElement('canvas');
      this.selectionCtx = this.selectionCanvas.getContext('2d', { willReadFrequently: true })!;
    }

    this.selectionCanvas.width = imageObj.width;
    this.selectionCanvas.height = imageObj.height;
    this.selectionCtx!.clearRect(0, 0, this.selectionCanvas.width, this.selectionCanvas.height);

    // 设置到 ImageObject
    (imageObj as any).selectionCanvas = this.selectionCanvas;
    (imageObj as any).hasSelection = true;
  }

  // 新增：清除 selectionCanvas
  private clearSelectionCanvas(): void {
    if (!this.currentImageObject) return;

    const imageObj = this.currentImageObject;
    const selectionCanvas = (imageObj as any).selectionCanvas as HTMLCanvasElement;

    if (selectionCanvas) {
      const ctx = selectionCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
      }
    }

    (imageObj as any).hasSelection = false;
    this.editor.requestRender();
  }

  // 新增：在 selectionCanvas 上绘制将被移除的区域（红色）
  private drawRemovalPreview(
    baseMask: Uint8Array,
    width: number,
    height: number,
    imageObj: ImageObject,
  ): void {
    const selectionCanvas = (imageObj as any).selectionCanvas as HTMLCanvasElement;
    if (!selectionCanvas) return;

    const ctx = selectionCanvas.getContext('2d');
    if (!ctx) return;

    // 确保画布尺寸正确
    if (selectionCanvas.width !== width || selectionCanvas.height !== height) {
      selectionCanvas.width = width;
      selectionCanvas.height = height;
    }

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 创建 ImageData 显示红色重叠区域
    const imageData = new ImageData(width, height);
    const data = imageData.data;

    const redColor = hexToRgb('#fa2730');

    for (let i = 0; i < baseMask.length; i++) {
      const pixelIndex = i * 4;
      const hasBase = baseMask[i] > 0;

      if (hasBase) {
        // 重叠区域：显示红色（将被移除）
        data[pixelIndex] = redColor.r;
        data[pixelIndex + 1] = redColor.g;
        data[pixelIndex + 2] = redColor.b;
        data[pixelIndex + 3] = this.options.opacity! * 255;
      } else {
        // 其他区域：透明
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }

    // 将红色区域绘制到 selectionCanvas
    ctx.putImageData(imageData, 0, 0);

    // 标记有选区，触发渲染
    (imageObj as any).hasSelection = true;
  }
}
