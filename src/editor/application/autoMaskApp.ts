// oxlint-disable-next-line filename-case
import EventEmitter from 'events';
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import {
  GridPlugin,
  MaskBrushPlugin,
  MaskRegionPlugin,
  OffsetMaskPlugin,
  ResizeZoomPlugin,
} from '../plugins';
import { EditorEvents, EditorRenderType, EditorTool } from '../types';
import { cloneCanvas, cloneOffscreenCanvas } from '../utils/math';

const gridConfig = {
  size: 6,
  showShadow: true,
  checkerboard: true,
  shadowColor: 'rgba(0, 0, 0, 0.4)',
};

export class AutoMaskApp extends EventEmitter {
  private originEditor: Editor | undefined;
  private previewEditor: Editor | undefined;
  zoomOptions: { minZoom: number; maxZoom: number };

  applyMaskHistory: any[] = [];
  applyMaskIndex: number = -1;
  initApplyMaskHistory: HTMLCanvasElement | null = null;

  private hoverMaskCanvas: HTMLCanvasElement | null = null;

  private pendingHoverUpdate: { region: any; canvas: HTMLCanvasElement | null } | null = null;
  private renderTimeout: any = null;
  private hoverMaskTempCanvas: HTMLCanvasElement | null = null;
  private isApplyInitMask: boolean = false;
  private tempRecordCanvas: HTMLCanvasElement | null = null;

  constructor(zoomOptions?: { minZoom?: number; maxZoom?: number }) {
    super();
    this.zoomOptions = {
      minZoom: zoomOptions?.minZoom ?? 0.05,
      maxZoom: zoomOptions?.maxZoom ?? 100,
    };
    this.applyMaskHistory = [];
    this.applyMaskIndex = -1;
    this.initApplyMaskHistory = null;
  }

  /**
   * 挂载应用
   * @param originCanvas 原图画布
   * @param previewCanvas 预览画布
   */
  mount(originCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement) {
    this.originEditor = new Editor({
      container: originCanvas,
      enableHistory: true,
      enableSelection: false,
      plugins: [
        new GridPlugin(gridConfig),
        new MaskBrushPlugin({
          color: '#21d1d1',
          opacity: 0.4,
        }),
        new ResizeZoomPlugin(),
        new MaskRegionPlugin({
          hoverColor: '#21d1d1',
          hoverOpacity: 0.4,
          appliedColor: '#21d1d1',
          appliedOpacity: 0.4,
        }),
        new OffsetMaskPlugin(),
      ],
      zoomOptions: this.zoomOptions,
    });
    this.previewEditor = new Editor({
      container: previewCanvas,
      enableHistory: false,
      enableSelection: false,
      plugins: [new GridPlugin(gridConfig), new ResizeZoomPlugin()],
      zoomOptions: this.zoomOptions,
    });

    this.bindEvents();
  }

  /**
   * 绑定事件
   */
  private bindEvents() {
    this.originEditor?.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit('zoomChange', { zoom });
      this.forceSyncViewports('preview');
    });

    this.previewEditor?.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit('zoomChange', { zoom });
      this.forceSyncViewports('origin');
    });

    this.originEditor?.on(EditorEvents.VIEWPORT_PAN, () => {
      this.forceSyncViewports('preview');
    });

    this.previewEditor?.on(EditorEvents.VIEWPORT_PAN, () => {
      this.forceSyncViewports('origin');
    });

    // 监听历史栈变化
    this.originEditor?.on(
      EditorEvents.HISTORY_STATE_CHANGED, // 触发了新的历史栈
      ({ canUndo, canRedo, description }) => {
        requestAnimationFrame(() => {
          this.recordMaskHistory();
        });
        if (description === 'Mask brushed' || description!.indexOf('mask region') > -1) {
          this.isApplyInitMask = false;
          this.getOffsetMaskPlugin()?.setPreMaskCanvasMap();
        }
        if (description === 'Offset mask') {
          this.applyOffsetMask();
        }
        this.emit('historyChange', { canUndo, canRedo });
      },
    );

    this.originEditor?.on(EditorEvents.HISTORY_UNDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo });
      --this.applyMaskIndex;
      let canvas = this.applyMaskHistory[this.applyMaskIndex];
      if (!canvas) {
        canvas = this.initApplyMaskHistory;
        this.isApplyInitMask = true;
        this.applyMask(canvas);
      } else {
        // const c = document.createElement('canvas');
        // c.width = canvas.width;
        // c.height = canvas.height;
        // c.getContext('2d')?.putImageData(canvas as ImageData, 0, 0);
        this.isApplyInitMask = false;
        this.applyMask(canvas);
      }
    });

    this.originEditor?.on(EditorEvents.HISTORY_REDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo });
      ++this.applyMaskIndex;
      const canvas = this.applyMaskHistory[this.applyMaskIndex];
      if (canvas && canvas.width && canvas.height) {
        // const c = document.createElement('canvas');
        // c.width = canvas.width;
        // c.height = canvas.height;
        // c.getContext('2d')?.putImageData(canvas as ImageData, 0, 0);
        this.isApplyInitMask = false;
        this.applyMask(canvas);
      }
    });

    // this.originEditor?.on(EditorEvents.MASK_CHANGED, ({ canvasData }) => {
    //   if (this.applyMaskIndex < this.applyMaskHistory.length - 1) {
    //     this.applyMaskHistory = this.applyMaskHistory.slice(0, this.applyMaskIndex + 1);
    //   }
    //   this.applyMaskHistory.push(canvasData as ImageData);
    //   this.applyMaskIndex = this.applyMaskHistory.length - 1;
    //   if (!this.initApplyMaskHistory && canvasData) {
    //     const c = document.createElement('canvas');
    //     c.width = canvasData?.width ?? 0;
    //     c.height = canvasData?.height ?? 0;
    //     this.initApplyMaskHistory = c;
    //   }
    // });

    this.originEditor?.on(EditorEvents.MASK_BRUSH_DRAW, ({ canvas }) => {
      this.applyMask(canvas);
    });

    this.originEditor?.on(EditorEvents.MASK_REGION_APPLIED, ({ canvas }) => {
      if (canvas) {
        this.applyMask(canvas);
        this.hoverMaskCanvas = null;
        this.applyHoverMask(null);
      }
    });

    this.originEditor?.on(EditorEvents.MASK_REGION_UNAPPLIED, ({ canvas }) => {
      if (canvas) {
        this.applyMask(canvas);
        this.hoverMaskCanvas = null;
        this.applyHoverMask(null);
      }
    });

    this.originEditor?.on(EditorEvents.MASK_REGION_HOVER, ({ region }) => {
      if (region) {
        this.onMaskRegionHover(region);
        const canvas = this.getHoverMaskCanvas();
        this.scheduleHoverRender(region, canvas || null);
      } else {
        this.hoverMaskCanvas = null;
        this.scheduleHoverRender(null, null);
      }
    });
  }

  private scheduleHoverRender(region: any, canvas: HTMLCanvasElement | null): void {
    // 记录待更新的状态
    this.pendingHoverUpdate = { region, canvas };

    // 清除之前的定时器
    if (this.renderTimeout) {
      cancelAnimationFrame(this.renderTimeout);
    }

    // 使用requestAnimationFrame渲染
    this.renderTimeout = requestAnimationFrame(() => {
      if (this.pendingHoverUpdate) {
        const { region, canvas } = this.pendingHoverUpdate;

        // 批量更新状态
        this.onMaskRegionHover(region);
        this.applyHoverMask(canvas);

        // 请求渲染
        this.previewEditor?.requestRender();

        // 清理状态
        this.pendingHoverUpdate = null;
        this.renderTimeout = null;
      }
    });
  }

  /**
   *
   * @param _regionId
   * @returns
   */
  private getHoverMaskCanvas() {
    if (!this.hoverMaskCanvas) {
      return null;
    }
    const mode = this.getMaskRegionPlugin()?.getMode();
    const objs = this.previewEditor?.objectManager.getAllObjects();
    const imageObj = objs?.[0] as ImageObject;

    if (!this.hoverMaskTempCanvas) {
      this.hoverMaskTempCanvas = document.createElement('canvas');
      this.hoverMaskTempCanvas.width = imageObj.width;
      this.hoverMaskTempCanvas.height = imageObj.height;
    }
    const maskCtx = this.hoverMaskCanvas.getContext('2d');

    const tempCtx = this.hoverMaskTempCanvas.getContext('2d');
    if (maskCtx && tempCtx) {
      tempCtx.clearRect(0, 0, imageObj.width, imageObj.height);
      let applyMaskCanvas = imageObj.applyMaskCanvas || this.hoverMaskTempCanvas;

      if (this.isApplyInitMask) {
        applyMaskCanvas.getContext('2d')?.clearRect(0, 0, imageObj.width, imageObj.height);
      }
      const cloneApplyMaskCanvas = cloneCanvas(applyMaskCanvas);
      tempCtx.drawImage(this.hoverMaskCanvas, 0, 0);
      const cloneCtx = cloneApplyMaskCanvas.getContext('2d');
      if (cloneCtx) {
        cloneCtx.globalCompositeOperation = mode === 'remove' ? 'destination-out' : 'source-over';
        cloneCtx.drawImage(this.hoverMaskTempCanvas, 0, 0);
      }
      return cloneApplyMaskCanvas;
    }
  }

  private recordMaskHistory() {
    const images = this.originEditor?.objectManager.getAllObjects();
    let maskCanvas = (images?.[0] as ImageObject).maskCanvas;
    if (maskCanvas) {
      if (!this.tempRecordCanvas) {
        this.tempRecordCanvas = document.createElement('canvas');
        this.tempRecordCanvas.width = maskCanvas.width;
        this.tempRecordCanvas.height = maskCanvas.height;
      }
      const ctx = this.tempRecordCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, this.tempRecordCanvas.width, this.tempRecordCanvas.height);
      ctx.save();
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.restore();
      const canvas = cloneOffscreenCanvas(this.tempRecordCanvas);
      if (this.applyMaskIndex < this.applyMaskHistory.length - 1) {
        this.applyMaskHistory = this.applyMaskHistory.slice(0, this.applyMaskIndex + 1);
      }
      this.applyMaskHistory.push(canvas);
      this.applyMaskIndex = this.applyMaskHistory.length - 1;
      if (!this.initApplyMaskHistory && canvas) {
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const curCtx = c.getContext('2d')!;
        curCtx.fillStyle = 'rgba(255, 255, 255, 255)';
        curCtx.fillRect(0, 0, canvas.width, canvas.height);
        this.initApplyMaskHistory = c;
      }
    }
  }

  private applyOffsetMask() {
    const objs = this.originEditor?.objectManager.getAllObjects();
    if (objs?.length) {
      const maskCanvas = (objs[0] as ImageObject).maskCanvas;
      if (maskCanvas) {
        this.applyMask(maskCanvas);
      }
    }
  }

  private applyMask(canvas: HTMLCanvasElement) {
    const images = this.previewEditor?.objectManager.getAllObjects();
    if (images?.length) {
      (images[0] as ImageObject).applyMask(canvas);
    }
    this.previewEditor?.requestRender();
  }

  /**
   * ⚡ 优化：批量应用hover蒙版，减少中间状态
   */
  private applyHoverMask(canvas: HTMLCanvasElement | null) {
    const images = this.previewEditor?.objectManager.getAllObjects();
    if (images?.length) {
      (images[0] as ImageObject).hoverMask(canvas);
    }
    // 注意：这里不调用requestRender，由调用方统一控制
  }

  private onMaskRegionHover(region: any) {
    if (region) {
      this.hoverMaskCanvas = region;
    } else {
      this.hoverMaskCanvas = null;
      this.applyHoverMask(null);
    }
  }

  /**
   * 强制同步视口
   * @param editor 编辑器
   */
  private forceSyncViewports(editor: 'origin' | 'preview') {
    if (editor === 'origin') {
      const viewport = this.previewEditor?.viewport.getState();
      this.originEditor?.viewport.setState({
        ...viewport,
      });
      this.originEditor?.requestRender(EditorRenderType.TRANSFORM_ONLY);
    } else {
      const viewport = this.originEditor?.viewport.getState();
      this.previewEditor?.viewport.setState({
        ...viewport,
      });
      this.previewEditor?.requestRender(EditorRenderType.TRANSFORM_ONLY);
    }
  }

  /**
   * 设置图片
   * @param src 图片地址
   */
  async setImage(src: string) {
    await this.originEditor?.importByJson([{ src, type: 'image' }]);
    await this.previewEditor?.importByJson([{ src, type: 'image' }]);
  }

  private getMaskBrushPlugin() {
    return this.originEditor?.plugins.getPlugin('maskBrush') as MaskBrushPlugin;
  }

  private getMaskRegionPlugin() {
    return this.originEditor?.plugins.getPlugin('maskRegion') as MaskRegionPlugin;
  }

  private getOffsetMaskPlugin() {
    return this.originEditor?.plugins.getPlugin('offsetMask') as OffsetMaskPlugin;
  }

  /**
   * 放大
   */
  zoomIn() {
    this.originEditor?.zoomIn();
  }

  /**
   * 缩小
   */
  zoomOut() {
    this.originEditor?.zoomOut();
  }

  /**
   * 缩放
   * @param zoom 缩放比例
   */
  zoomTo(zoom: number) {
    this.originEditor?.zoomTo(zoom);
  }

  /**
   * 缩放适应
   */
  zoomToFit() {
    this.originEditor?.zoomToFit();
  }

  setTool(tool: EditorTool) {
    this.originEditor?.setTool(tool);
  }

  setBrushSize(size: number) {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setBrushSize(size);
    }
  }

  setBrushMode(mode: 'add' | 'remove') {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  setBashHardness(hardness: number) {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setBashHardness(hardness);
    }
  }

  async loadAutoMaskImage(srcs: string[]) {
    const plugin = this.getMaskRegionPlugin();
    let maskRegions: any[] = [];
    for (let i = 0; i < srcs.length; i++) {
      const result = await plugin.createMaskRegionFromImage(srcs[i], srcs[i], srcs[i]);
      maskRegions.push(result);
    }
    plugin.loadMasks(maskRegions);
  }

  setMaskRegionMode(mode: 'add' | 'remove') {
    const plugin = this.getMaskRegionPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  setOffsetMask(offset: number) {
    const plugin = this.getOffsetMaskPlugin();
    if (plugin) {
      plugin.setOffset(offset);
    }
  }

  undo() {
    this.originEditor?.undo();
  }
  redo() {
    this.originEditor?.redo();
  }

  destroy() {
    // 清理定时器
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }

    this.originEditor?.destroy();
    this.previewEditor?.destroy();
    this.removeAllListeners();
    this.initApplyMaskHistory = null;
    this.hoverMaskCanvas = null;
    this.applyMaskHistory = [];
    this.applyMaskIndex = -1;
  }
}
