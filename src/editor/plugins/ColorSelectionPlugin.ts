// 颜色选区插件 - 通过圆形选区和洪水算法进行颜色选择
import type { Plugin, Point } from '../types';
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { MathUtils } from '../utils/math';

export interface ColorSelectionPluginOptions {
  enabled?: boolean;
  tolerance?: number; // 颜色容差值
  selectionColor?: string; // 选区显示颜色
  selectionOpacity?: number; // 选区透明度
  debug?: boolean; // 调试模式
}

export class ColorSelectionPlugin implements Plugin {
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
  private selectionCanvas: HTMLCanvasElement | null = null;
  private selectionCtx: CanvasRenderingContext2D | null = null;

  // 实时预览与缓存
  private rafId: number | null = null;
  private liveComputePending: boolean = false;
  private lastPreviewParams: { cx: number; cy: number; r: number; tolerance: number } | null = null;
  private lowResCache: WeakMap<ImageObject, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; imageData: ImageData; scaleX: number; scaleY: number } > = new WeakMap();
  private fullImageDataCache: WeakMap<ImageObject, ImageData> = new WeakMap();
  private previewMaskBuffer: Uint8Array | null = null;
  private maxPreviewDim: number = 288; // 低分辨率实时预览上限尺寸，平衡速度与质量

  // Worker 支持
  private worker: Worker | null = null;
  private workerJobId = 1;
  private pendingPreviewJobId: number | null = null;
  private pendingFinalJobId: number | null = null;
  private pendingFinalTarget: ImageObject | null = null;

  // 渲染钩子引用，便于移除
  private drawHook = (ctx: CanvasRenderingContext2D) => this.drawCircleSelection(ctx);
  
  constructor(options: ColorSelectionPluginOptions = {}) {
    this.options = {
      enabled: true,
      tolerance: 32,
      selectionColor: '#00FF00',
      selectionOpacity: 0.3,
      debug: false,
      ...options
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    
    // 绑定鼠标事件
    this.bindEvents();
    
    // 注册渲染钩子，用于绘制实时圆形选区
    this.editor.hooks.after('render:after', this.drawHook);

    // 初始化 worker（Vite 支持 new URL(_, import.meta.url) 导入）
    try {
      // @ts-ignore - 构建工具需支持 Worker bundling
      const url = new URL('./workers/colorSelectionWorker.ts', import.meta.url);
      this.worker = new Worker(url, { type: 'module' });
      this.worker.onmessage = this.onWorkerMessage;
    } catch (e) {
      this.worker = null; // 不支持则回退主线程
      if (this.options.debug) console.warn('ColorSelection worker disabled or failed to init:', e);
    }
    
    // 添加插件方法到编辑器
    (editor as any).colorSelection = {
      enable: () => this.enable(),
      disable: () => this.disable(),
      setTolerance: (tolerance: number) => this.setTolerance(tolerance),
      setSelectionColor: (color: string) => this.setSelectionColor(color),
      setSelectionOpacity: (opacity: number) => this.setSelectionOpacity(opacity),
      clearSelection: () => this.clearSelection(),
      getSelectionMask: () => this.getSelectionMask(),
      isEnabled: () => this.options.enabled,
      getTolerance: () => this.options.tolerance,
      getSelectionColor: () => this.options.selectionColor,
      getSelectionOpacity: () => this.options.selectionOpacity
    };
  }

  uninstall(editor: Editor): void {
    this.unbindEvents();
    this.clearSelection();
    
    this.editor.hooks.removeHook('render:after', this.drawHook);
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    delete (editor as any).colorSelection;
  }

  private bindEvents(): void {
    const canvas = this.editor.getCanvas();
    
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  private unbindEvents(): void {
    const canvas = this.editor.getCanvas();
    
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
  }

  private onMouseDown = (event: MouseEvent) => {
    if (!this.options.enabled || this.editor.getTool() !== 'colorSelection') {
      return;
    }

    // 只处理左键点击
    if (event.button !== 0) {
      return;
    }

    const point = this.getMousePoint(event);
    const hitObject = this.editor.getObjectAt(point);
    
    if (hitObject && hitObject instanceof ImageObject) {
      this.isSelecting = true;
      this.startPoint = point;
      this.currentPoint = point;
      this.currentImageObject = hitObject;
      
      // 清除之前的选区
      this.clearSelection();

      // 准备低分辨率缓存以便拖动实时预览
      this.prepareLowResCache(hitObject);
      
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.isSelecting || !this.startPoint || !this.currentImageObject) {
      return;
    }

    this.currentPoint = this.getMousePoint(event);

    // 计划一次实时预览计算（使用 RAF 合并多次触发）
    this.scheduleLivePreview();
    
    // 仍保留渲染请求以绘制圆形提示（可选）
    const now = performance.now();
    if (now - this.lastRenderTime > this.renderDelay) {
      this.editor.requestRender();
      this.lastRenderTime = now;
    }
    
    event.preventDefault();
  };

  private onMouseUp = (_event: MouseEvent) => {
    if (this.isSelecting && this.startPoint && this.currentPoint && this.currentImageObject) {
      // 停止未完成的实时计算
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.liveComputePending = false;
      }

      // 鼠标抬起时执行一次高分辨率颜色选择，替换预览
      this.performColorSelection();
      
      // 触发选择完成事件（预先发出，最终结果异步到达）
      this.editor.emit('colorSelection:completed', { 
        imageObject: this.currentImageObject,
        tolerance: this.options.tolerance 
      });
      
      // 停止交互，但保留预览画面，等待最终结果到达
      this.isSelecting = false;
      this.startPoint = null;
      this.currentPoint = null;
      // 注意：currentImageObject 置空以停止命中测试；final 会写入 pendingFinalTarget
      this.currentImageObject = null;
      this.lastPreviewParams = null;
      this.previewMaskBuffer = null;
      this.pendingPreviewJobId = null;
    }
  };

  private onMouseLeave = (_event: MouseEvent) => {
    if (this.isSelecting) {
      // 创建一个空的事件对象用于清理
      const fakeEvent = { button: 0 } as MouseEvent;
      this.onMouseUp(fakeEvent);
    }
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
      // 写入 selectionCanvas
      this.createSelectionCanvasFromMask(mask, width, height);
      if (this.currentImageObject) {
        (this.currentImageObject as any).selectionCanvas = this.selectionCanvas;
        (this.currentImageObject as any).selectionCtx = this.selectionCtx;
        (this.currentImageObject as any).hasSelection = true;
        this.editor.requestRender();
      }
    } else {
      if (!hasAny) {
        // 最终空掩码：不覆盖预览，直接结束
        this.pendingFinalTarget = null;
        this.pendingFinalJobId = null;
        return;
      }
      // 写入 selectionCanvas
      this.createSelectionCanvasFromMask(mask, width, height);
      const target = this.pendingFinalTarget;
      if (target) {
        (target as any).selectionCanvas = this.selectionCanvas;
        (target as any).selectionCtx = this.selectionCtx;
        (target as any).hasSelection = true;
      }
      // 同步内部 selectionMask 供外部获取
      this.selectionMask = mask;
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

  private getMousePoint(event: MouseEvent): Point {
    // 使用与Editor完全相同的方法
    const canvas = this.editor.getCanvas();
    const canvasPoint = MathUtils.getCanvasMousePoint(event, canvas);
    
    // 添加调试信息
    if (this.options.debug) {
      console.log('Raw event:', event.clientX, event.clientY);
      console.log('Canvas rect:', canvas.getBoundingClientRect());
      console.log('Canvas point before world transform:', canvasPoint);
      const worldPoint = this.editor.viewport.screenToWorld(canvasPoint);
      console.log('World point after transform:', worldPoint);
    }
    
    // 转换为世界坐标
    return this.editor.viewport.screenToWorld(canvasPoint);
  }

  // 实时预览：优先用 worker 在低分辨率上计算
  private scheduleLivePreview(): void {
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || !this.currentImageObject) return;
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

    this.lowResCache.set(imageObj, {
      canvas,
      ctx,
      imageData,
      scaleX: lowW / width,
      scaleY: lowH / height
    });
  }

  private computeLivePreviewWithWorker(): void {
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || !this.currentImageObject || !this.worker) return;
    const ready = this.lowResCache.get(this.currentImageObject);
    if (!ready) return;

    const { imageData, scaleX, scaleY } = ready;

    const localStart = this.worldToImageLocal(this.startPoint, this.currentImageObject);
    const localCurrent = this.worldToImageLocal(this.currentPoint, this.currentImageObject);

    const radiusHi = Math.sqrt(
      Math.pow(localCurrent.x - localStart.x, 2) + 
      Math.pow(localCurrent.y - localStart.y, 2)
    );

    const centerLow = { x: localStart.x * scaleX, y: localStart.y * scaleY };
    const radiusLow = radiusHi * Math.min(scaleX, scaleY);

    const tol = this.options.tolerance || 32;
    if (this.lastPreviewParams) {
      const dx = this.lastPreviewParams.cx - centerLow.x;
      const dy = this.lastPreviewParams.cy - centerLow.y;
      const dr = this.lastPreviewParams.r - radiusLow;
      if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75 && Math.abs(dr) < 0.75 && this.lastPreviewParams.tolerance === tol) {
        return;
      }
    }

    const jobId = ++this.workerJobId;
    this.pendingPreviewJobId = jobId;

    // 收集预览种子点（像素坐标）
    let seedPointsLow = this.getCircleSeedPointsInPixels(centerLow, radiusLow, imageData.width, imageData.height);
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
      tolerance: tol
    } as const;

    try {
      this.worker.postMessage(msg);
      this.lastPreviewParams = { cx: centerLow.x, cy: centerLow.y, r: radiusLow, tolerance: tol };
    } catch (e) {
      // 回退主线程
      this.computeLivePreview();
    }
  }

  private computeLivePreview(): void {
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || !this.currentImageObject) return;

    const ready = this.lowResCache.get(this.currentImageObject);
    if (!ready) {
      // 若未准备好缓存，尝试准备一次
      this.prepareLowResCache(this.currentImageObject);
    }
    const cache = this.lowResCache.get(this.currentImageObject);
    if (!cache) return;

    const { imageData, scaleX, scaleY } = cache;

    // 世界坐标 -> 图像本地坐标（高分辨率）
    const localStart = this.worldToImageLocal(this.startPoint, this.currentImageObject);
    const localCurrent = this.worldToImageLocal(this.currentPoint, this.currentImageObject);

    // 半径（高分辨率像素）
    const radiusHi = Math.sqrt(
      Math.pow(localCurrent.x - localStart.x, 2) + 
      Math.pow(localCurrent.y - localStart.y, 2)
    );

    // 转到低分辨率像素坐标
    const centerLow = { x: localStart.x * scaleX, y: localStart.y * scaleY };
    const radiusLow = radiusHi * Math.min(scaleX, scaleY);

    // 距离变化/容差未变动时跳过昂贵计算
    const tol = this.options.tolerance || 32;
    if (this.lastPreviewParams) {
      const dx = this.lastPreviewParams.cx - centerLow.x;
      const dy = this.lastPreviewParams.cy - centerLow.y;
      const dr = this.lastPreviewParams.r - radiusLow;
      if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75 && Math.abs(dr) < 0.75 && this.lastPreviewParams.tolerance === tol) {
        return;
      }
    }

    // 生成低分辨率圆形区域内的种子点（像素坐标系）
    let seedPointsLow = this.getCircleSeedPointsInPixels(
      centerLow,
      radiusLow,
      imageData.width,
      imageData.height
    );
    if (seedPointsLow.length === 0) {
      const x = Math.max(0, Math.min(imageData.width - 1, Math.round(centerLow.x)));
      const y = Math.max(0, Math.min(imageData.height - 1, Math.round(centerLow.y)));
      seedPointsLow = [{ x, y }];
    }

    // 在低分辨率 imageData 上执行洪水填充
    const lowResMask = this.floodFill(imageData, seedPointsLow, tol);

    // 记录参数，用于后续跳过
    this.lastPreviewParams = { cx: centerLow.x, cy: centerLow.y, r: radiusLow, tolerance: tol };

    // 将低分辨率蒙版写入 selectionCanvas（低分辨率），由 ImageObject 渲染时缩放至图像尺寸
    this.createSelectionCanvasFromMask(lowResMask, imageData.width, imageData.height);
    if (this.currentImageObject) {
      (this.currentImageObject as any).selectionCanvas = this.selectionCanvas;
      (this.currentImageObject as any).selectionCtx = this.selectionCtx;
      (this.currentImageObject as any).hasSelection = true;
    }

    this.editor.requestRender();
  }

  private drawCircleSelection(ctx: CanvasRenderingContext2D): void {
    // 只有在正在选择且工具激活时才绘制
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || 
        !this.options.enabled || this.editor.getTool() !== 'colorSelection') {
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
      Math.pow(viewportCurrent.y - viewportStart.y, 2)
    );
    
    // 如果半径太小就不绘制
    if (viewportRadius < 5) {
      ctx.restore();
      return;
    }
    
    // 使用屏幕坐标绘制
    const viewportCenter = viewportStart;
    
    // 绘制圆形选区
    ctx.strokeStyle = this.options.selectionColor || '#00FF00';
    ctx.lineWidth = 2;
    // ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(viewportCenter.x, viewportCenter.y, viewportRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // 恢复原来的变换矩阵
    ctx.restore();
  }

  private performColorSelection(): void {
    if (!this.startPoint || !this.currentPoint || !this.currentImageObject) return;

    // 如果有 worker，优先使用高分辨率 worker 计算
    if (this.worker) {
      const imageData = this.getImageDataCached(this.currentImageObject);
      if (!imageData) return;

      // 使用与旧逻辑一致的采样方式：基于世界中心、世界半径计算本地种子点集合
      const worldRadius = Math.sqrt(
        Math.pow(this.currentPoint.x - this.startPoint.x, 2) + 
        Math.pow(this.currentPoint.y - this.startPoint.y, 2)
      );
      let seedPointsWorld = this.getCircleAreaSeedPoints(this.startPoint, worldRadius, this.currentImageObject);
      if (seedPointsWorld.length === 0) {
        // 兜底：取中心像素
        const centerLocal = this.worldToImageLocal(this.startPoint, this.currentImageObject);
        const x = Math.max(0, Math.min(imageData.width - 1, Math.round(centerLocal.x)));
        const y = Math.max(0, Math.min(imageData.height - 1, Math.round(centerLocal.y)));
        seedPointsWorld = [{ x, y }];
      }

      const tol = this.options.tolerance || 32;

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
        seedPoints: seedPointsWorld,
        tolerance: tol
      } as const;
      try {
        this.worker.postMessage(msg);
        return; // 等待 worker 回调应用结果
      } catch (e) {
        // 回退主线程
        this.pendingFinalTarget = null;
      }
    }
    
    // 主线程回退：
    // 计算圆形选区半径（世界坐标 -> 图像本地坐标后计算）
    const radius = Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) + 
      Math.pow(this.currentPoint.y - this.startPoint.y, 2)
    );
    
    // 获取图像数据（带缓存）
    const imageData = this.getImageDataCached(this.currentImageObject);
    if (!imageData) return;
    
    // 生成圆形选区内的种子点（高分辨率）
    let seedPoints = this.getCircleAreaSeedPoints(this.startPoint, radius, this.currentImageObject);
    if (seedPoints.length === 0) {
      const centerLocal = this.worldToImageLocal(this.startPoint, this.currentImageObject);
      const x = Math.max(0, Math.min(imageData.width - 1, Math.round(centerLocal.x)));
      const y = Math.max(0, Math.min(imageData.height - 1, Math.round(centerLocal.y)));
      seedPoints = [{ x, y }];
    }
    
    // 执行洪水算法（高分辨率）
    this.selectionMask = this.floodFill(imageData, seedPoints, this.options.tolerance || 32);
    
    // 若结果为空，保留当前预览，不覆盖
    const hasAny = this.selectionMask.some(v => v > 0);
    if (!hasAny) return;

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

  private getCircleAreaSeedPoints(center: Point, radius: number, imageObj: ImageObject): Point[] {
    const localCenter = this.worldToImageLocal(center, imageObj);
    const localRadius = radius / Math.min(imageObj.transform.scaleX, imageObj.transform.scaleY) / this.editor.viewport.zoom;
    
    const seedPoints: Point[] = [];
    
    // 在圆形区域内采样种子点
    const sampleStep = Math.max(1, Math.floor(localRadius / 10)); // 根据半径调整采样密度
    
    for (let x = Math.floor(localCenter.x - localRadius); x <= Math.ceil(localCenter.x + localRadius); x += sampleStep) {
      for (let y = Math.floor(localCenter.y - localRadius); y <= Math.ceil(localCenter.y + localRadius); y += sampleStep) {
        // 检查点是否在圆形内
        const dx = x - localCenter.x;
        const dy = y - localCenter.y;
        if (dx * dx + dy * dy <= localRadius * localRadius) {
          // 检查点是否在图像范围内
          if (x >= 0 && x < imageObj.width && y >= 0 && y < imageObj.height) {
            seedPoints.push({ x, y });
          }
        }
      }
    }
    
    return seedPoints;
  }

  private floodFill(imageData: ImageData, seedPoints: Point[], tolerance: number): Uint8Array {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    
    // 收集所有种子点的颜色
    const seedColors: { r: number, g: number, b: number }[] = [];
    for (const seed of seedPoints) {
      const index = (seed.y * width + seed.x) * 4;
      if (index >= 0 && index < data.length) {
        seedColors.push({
          r: data[index],
          g: data[index + 1],
          b: data[index + 2]
        });
      }
    }
    
    // 如果没有有效的种子点，返回空蒙版
    if (seedColors.length === 0) {
      return mask;
    }
    
    // 使用广度优先搜索进行洪水填充（优化：数组队列 + 无 sqrt）
    const queueX: number[] = [];
    const queueY: number[] = [];
    let head = 0;
    
    // 标记种子点为已访问
    for (const seed of seedPoints) {
      const maskIndex = seed.y * width + seed.x;
      if (maskIndex >= 0 && maskIndex < visited.length) {
        visited[maskIndex] = 1;
        mask[maskIndex] = 255;
        queueX.push(seed.x);
        queueY.push(seed.y);
      }
    }
    
    const tolSq = tolerance * tolerance;
    
    while (head < queueX.length) {
      const cx = queueX[head];
      const cy = queueY[head];
      head++;
      
      // 四邻域
      if (cx - 1 >= 0) maybeVisit(cx - 1, cy);
      if (cx + 1 < width) maybeVisit(cx + 1, cy);
      if (cy - 1 >= 0) maybeVisit(cx, cy - 1);
      if (cy + 1 < height) maybeVisit(cx, cy + 1);
    }
    
    return mask;

    function maybeVisit(px: number, py: number) {
      const id = py * width + px;
      if (visited[id]) return;

      const pi = id * 4;
      const pr = data[pi];
      const pg = data[pi + 1];
      const pb = data[pi + 2];

      // 与任意一个种子颜色相似即可
      for (let i = 0; i < seedColors.length; i++) {
        const dr = pr - seedColors[i].r;
        const dg = pg - seedColors[i].g;
        const db = pb - seedColors[i].b;
        if (dr * dr + dg * dg + db * db <= tolSq) {
          visited[id] = 1;
          mask[id] = 255;
          queueX.push(px);
          queueY.push(py);
          return;
        }
      }
    }
  }

  private isColorSimilar(color1: { r: number, g: number, b: number }, color2: { r: number, g: number, b: number }, tolerance: number): boolean {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    
    // 使用欧几里得距离
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    return distance <= tolerance;
  }

  private createSelectionMask(): void {
    if (!this.selectionMask || !this.currentImageObject) return;
    
    const width = this.currentImageObject.width;
    const height = this.currentImageObject.height;
    
    // 创建选区蒙版画布
    this.selectionCanvas = document.createElement('canvas');
    this.selectionCtx = this.selectionCanvas.getContext('2d')!;
    this.selectionCanvas.width = width;
    this.selectionCanvas.height = height;
    
    // 将蒙版数据转换为可视化的画布
    const imageData = this.selectionCtx.createImageData(width, height);
    const data = imageData.data;
    
    for (let i = 0; i < this.selectionMask.length; i++) {
      const pixelIndex = i * 4;
      const maskValue = this.selectionMask[i];
      
      if (maskValue > 0) {
        // 设置选区颜色
        const color = this.hexToRgb(this.options.selectionColor || '#00FF00');
        data[pixelIndex] = color.r;     // R
        data[pixelIndex + 1] = color.g; // G
        data[pixelIndex + 2] = color.b; // B
        data[pixelIndex + 3] = Math.floor(255 * (this.options.selectionOpacity || 0.3)); // A
      } else {
        // 透明区域
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }
    
    this.selectionCtx.putImageData(imageData, 0, 0);
  }

  private createSelectionCanvasFromMask(mask: Uint8Array, width: number, height: number): void {
    if (!this.selectionCanvas || !this.selectionCtx || this.selectionCanvas.width !== width || this.selectionCanvas.height !== height) {
      this.selectionCanvas = document.createElement('canvas');
      this.selectionCtx = this.selectionCanvas.getContext('2d')!;
      this.selectionCanvas.width = width;
      this.selectionCanvas.height = height;
    }

    // 复用或创建 imageData
    const imageData = this.selectionCtx.createImageData(width, height);
    const data = imageData.data;

    const color = this.hexToRgb(this.options.selectionColor || '#00FF00');
    const alpha = Math.floor(255 * (this.options.selectionOpacity || 0.3));

    for (let i = 0; i < mask.length; i++) {
      const pixelIndex = i * 4;
      const maskValue = mask[i];
      if (maskValue > 0) {
        data[pixelIndex] = color.r;
        data[pixelIndex + 1] = color.g;
        data[pixelIndex + 2] = color.b;
        data[pixelIndex + 3] = alpha;
      } else {
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }

    this.selectionCtx.putImageData(imageData, 0, 0);
  }

  private applySelectionToImage(): void {
    if (!this.selectionCanvas || !this.currentImageObject) return;
    
    // 将选区蒙版应用到图像对象
    (this.currentImageObject as any).selectionCanvas = this.selectionCanvas;
    (this.currentImageObject as any).selectionCtx = this.selectionCtx;
    (this.currentImageObject as any).hasSelection = true;
    
    // 请求重渲染
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

  private hexToRgb(hex: string): { r: number, g: number, b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 255, b: 0 };
  }
  
  // 公共方法
  public enable(): void {
    this.options.enabled = true;
    this.editor.emit('colorSelection:enabled');
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
    this.editor.emit('colorSelection:disabled');
  }

  public setTolerance(tolerance: number): void {
    this.options.tolerance = Math.max(0, Math.min(255, tolerance));
    this.lastPreviewParams = null; // 容差改变，强制刷新
    this.editor.emit('colorSelection:tolerance-changed', { tolerance: this.options.tolerance });
  }

  public setSelectionColor(color: string): void {
    this.options.selectionColor = color;
    this.editor.emit('colorSelection:color-changed', { color });
  }

  public setSelectionOpacity(opacity: number): void {
    this.options.selectionOpacity = Math.max(0, Math.min(1, opacity));
    this.editor.emit('colorSelection:opacity-changed', { opacity: this.options.selectionOpacity });
  }

  public clearSelection(): void {
    this.selectionMask = null;
    this.selectionCanvas = null;
    this.selectionCtx = null;
    
    // 清除所有图像对象的选区
    const objects = this.editor.objectManager.getAllObjects();
    objects.forEach((obj: any) => {
      if (obj instanceof ImageObject) {
        delete (obj as any).selectionCanvas;
        delete (obj as any).selectionCtx;
        delete (obj as any).hasSelection;
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
    this.editor.emit('colorSelection:cleared');
  }

  public getSelectionMask(): Uint8Array | null {
    return this.selectionMask;
  }

  // 基于像素坐标的圆形区域采样（不做世界->本地转换）
  private getCircleSeedPointsInPixels(centerPx: Point, radiusPx: number, width: number, height: number): Point[] {
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
}