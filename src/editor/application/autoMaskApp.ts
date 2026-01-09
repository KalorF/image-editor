// oxlint-disable-next-line filename-case
import { EditorType, createEditor } from '../index';
import { ImageObject } from '../objects/ImageObject';
import {
  ColorSelectionPlugin,
  GridPlugin,
  MaskBrushPlugin,
  MaskRegionPlugin,
  OffsetMaskPlugin,
  OffsetPlugin,
  ResizeZoomPlugin,
  SubjectExtractionMaskPlugin,
} from '../plugins';
import { EditorEvents, EditorHooks, EditorRenderType, EditorTool } from '../types';
import { cloneCanvas, cloneOffscreenCanvas, convertMaskToTransparent } from '../utils/math';
import EventEmitter from '../utils/mitt';
import { hasOverlappingPixels, loadImage } from '../utils/tools';

const gridConfig = {
  size: 6,
  showShadow: true,
  checkerboard: true,
  shadowColor: 'rgba(0, 0, 0, 0.4)',
};

const PLUGIN_DEFAULT_COLOR = '#00c789';
const PLUGIN_DEFAULT_OPACITY = 0.4;
export class AutoMaskApp extends EventEmitter {
  private originEditor: EditorType | undefined;
  private previewEditor: EditorType | undefined;
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
  private colorSelectionOptions: { pickAddIcon?: string; pickRemoveIcon?: string } = {};
  private smoothValue: number = 0;
  private offsetValue: number = 0;

  constructor(options?: {
    minZoom?: number;
    maxZoom?: number;
    pickAddIcon?: string;
    pickRemoveIcon?: string;
  }) {
    super();
    this.zoomOptions = {
      minZoom: options?.minZoom ?? 0.05,
      maxZoom: options?.maxZoom ?? 100,
    };
    this.colorSelectionOptions = {
      pickAddIcon: options?.pickAddIcon ?? 'crosshair',
      pickRemoveIcon: options?.pickRemoveIcon ?? 'crosshair',
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
    // 原图区域
    this.originEditor = createEditor({
      container: originCanvas,
      enableHistory: true,
      enableSelection: false,
      plugins: [
        new GridPlugin(gridConfig),
        new MaskBrushPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
        }),
        new ResizeZoomPlugin(),
        new MaskRegionPlugin({
          hoverColor: PLUGIN_DEFAULT_COLOR,
          hoverOpacity: PLUGIN_DEFAULT_OPACITY,
          appliedColor: PLUGIN_DEFAULT_COLOR,
          appliedOpacity: PLUGIN_DEFAULT_OPACITY,
        }),
        new OffsetMaskPlugin(),
        new ColorSelectionPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
          pickAddIcon: this.colorSelectionOptions.pickAddIcon,
          pickRemoveIcon: this.colorSelectionOptions.pickRemoveIcon,
        }),
        new SubjectExtractionMaskPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
        }),
        new OffsetPlugin(),
      ],
      zoomOptions: this.zoomOptions,
    });

    // 预览区域
    this.previewEditor = createEditor({
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
    // 监听原图区域缩放
    this.originEditor?.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit('zoomChange', { zoom });
      this.forceSyncViewports('preview');
    });

    // 监听预览区域缩放
    this.previewEditor?.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit('zoomChange', { zoom });
      this.forceSyncViewports('origin');
    });

    // 监听原图区域平移
    this.originEditor?.on(EditorEvents.VIEWPORT_PAN, () => {
      this.forceSyncViewports('preview');
    });

    // 监听预览区域平移
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
          this.setOffset(0);
          this.getOffsetPlugin()?.setPreMaskCanvasMap();
        }
        if (description === 'Offset mask') {
          this.applyOffsetMask();
        }

        if (description === 'extraction mask applied') {
          this.applyOffsetMask();
        }

        if (description && description.indexOf('Color selection') > -1) {
          this.setOffsetMask(0);
          this.getOffsetPlugin()?.setPreMaskCanvasMap();
        }
        this.emit('historyChange', { canUndo, canRedo });
      },
    );

    // 监听历史栈撤销
    this.originEditor?.on(EditorEvents.HISTORY_UNDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo });
      --this.applyMaskIndex;
      let canvas = this.applyMaskHistory[this.applyMaskIndex];
      if (!canvas) {
        canvas = this.initApplyMaskHistory;
        this.isApplyInitMask = true;
        this.applyMask(canvas);
      } else {
        this.isApplyInitMask = false;
        this.applyMask(canvas);
      }
      this.setOffsetMask(0);
      this.getOffsetPlugin()?.setPreMaskCanvasMap();
    });

    // 监听历史栈重做
    this.originEditor?.on(EditorEvents.HISTORY_REDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo });
      ++this.applyMaskIndex;
      const canvas = this.applyMaskHistory[this.applyMaskIndex];
      if (canvas && canvas.width && canvas.height) {
        this.isApplyInitMask = false;
        this.applyMask(canvas);
      }
      this.setOffsetMask(0);
      this.getOffsetPlugin()?.setPreMaskCanvasMap();
    });

    // 监听蒙版绘制
    this.originEditor?.on(EditorEvents.MASK_BRUSH_DRAW, ({ canvas }) => {
      this.applyMask(canvas);
    });

    // 监听蒙版区域应用
    this.originEditor?.on(EditorEvents.MASK_REGION_APPLIED, ({ canvas, needHistory }) => {
      if (!needHistory && canvas) {
        this.initApplyMaskHistory = cloneCanvas(canvas);
        this.isApplyInitMask = true;
        this.originEditor?.requestRender();
        this.applyMask(this.initApplyMaskHistory);
        return;
      }
      if (canvas) {
        this.applyMask(canvas);
        this.hoverMaskCanvas = null;
        this.applyHoverMask(null);
      }
    });

    // 监听蒙版区域取消应用
    this.originEditor?.on(EditorEvents.MASK_REGION_UNAPPLIED, ({ canvas }) => {
      if (canvas) {
        this.applyMask(canvas);
        this.hoverMaskCanvas = null;
        this.applyHoverMask(null);
      }
    });

    // 监听蒙版区域悬停
    this.originEditor?.on(EditorEvents.MASK_REGION_HOVER, ({ region, mode }) => {
      if (region) {
        this.onMaskRegionHover(region);
        const canvas = this.getHoverMaskCanvas(mode);
        this.scheduleHoverRender(region, canvas || null);
      } else {
        this.hoverMaskCanvas = null;
        this.scheduleHoverRender(null, null);
      }
    });

    this.originEditor?.on(EditorEvents.COLOR_SELECTION_UPDATED, ({ canvas }) => {
      if (canvas) {
        this.applyMask(canvas);
      }
    });
  }

  /**
   * 调度悬停渲染
   * @param region 蒙版区域
   * @param canvas 蒙版画布
   */
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
   * 获取悬停蒙版画布
   * @param _regionId
   * @returns
   */
  private getHoverMaskCanvas(mode?: string) {
    if (!this.hoverMaskCanvas) {
      return null;
    }
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
      const applyMaskCanvas = imageObj.applyMaskCanvas || this.hoverMaskTempCanvas;

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

  /**
   * 记录蒙版历史
   */
  private recordMaskHistory() {
    const images = this.originEditor?.objectManager.getAllObjects();
    let maskCanvas = (images?.[0] as ImageObject)?.maskCanvas;
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
        curCtx.fillRect(0, 0, canvas.width, canvas.height);
        this.initApplyMaskHistory = c;
      }
    }
  }

  /**
   * 应用偏移蒙版
   */
  private applyOffsetMask() {
    const objs = this.originEditor?.objectManager.getAllObjects();
    if (objs?.length) {
      const maskCanvas = (objs[0] as ImageObject).maskCanvas;
      if (maskCanvas) {
        this.applyMask(maskCanvas);
      }
    }
  }

  /**
   * 应用蒙版
   * @param canvas 蒙版画布
   */
  private applyMask(canvas: HTMLCanvasElement) {
    const images = this.previewEditor?.objectManager.getAllObjects();
    if (images?.length) {
      (images[0] as ImageObject).applyMask(canvas);
    }
    this.previewEditor?.requestRender();
  }

  /**
   * 应用悬停蒙版
   * @param canvas 蒙版画布
   */
  private applyHoverMask(canvas: HTMLCanvasElement | null) {
    const images = this.previewEditor?.objectManager.getAllObjects();
    if (images?.length) {
      (images[0] as ImageObject).hoverMask(canvas);
    }
    // 注意：这里不调用requestRender，由调用方统一控制
  }

  /**
   * 处理蒙版区域悬停
   * @param region 蒙版区域
   */
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
    await Promise.race([
      this.originEditor?.importByJson([{ src, type: 'image' }]),
      this.previewEditor?.importByJson([{ src, type: 'image' }]),
    ]);
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

  private getColorSelectionPlugin() {
    return this.originEditor?.plugins.getPlugin('colorSelection') as ColorSelectionPlugin;
  }

  private getOffsetPlugin() {
    return this.originEditor?.plugins.getPlugin('offset') as OffsetPlugin;
  }

  private getSubjectExtractionMaskPlugin() {
    return this.originEditor?.plugins.getPlugin(
      'subjectExtractionMask',
    ) as SubjectExtractionMaskPlugin;
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

  resetZoom() {
    this.originEditor?.viewport.updateSize();
    this.previewEditor?.viewport.updateSize();
  }

  /**
   * 设置工具
   * @param tool 工具
   */
  setTool(tool: EditorTool) {
    this.originEditor?.setTool(tool);
  }

  /**
   * 设置画笔大小
   * @param size 画笔大小
   */
  setBrushSize(size: number) {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setBrushSize(size);
    }
  }

  /**
   * 设置画笔模式
   * @param mode 画笔模式
   */
  setBrushMode(mode: 'add' | 'remove') {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  /**
   * 设置画笔硬度
   * @param hardness 画笔硬度
   */
  setBashHardness(hardness: number) {
    const plugin = this.getMaskBrushPlugin();
    if (plugin) {
      plugin.setBashHardness(hardness);
    }
  }

  /**
   * 加载自动蒙版图片
   * @param srcs 图片地址
   */
  async loadAutoMaskImage(srcs: { src: string; name: string }[], texts: string[] = []) {
    const plugin = this.getMaskRegionPlugin();
    let maskRegions: any[] = [];
    const promises = [];
    console.time('loadAutoMaskImage');
    for (let i = 0; i < srcs.length; i++) {
      const { src, name } = srcs[i];
      promises.push(plugin.createMaskRegionFromImage(name, name, src));
      // const result = await plugin.createMaskRegionFromImage(name, name, src);
      // maskRegions.push(result);
    }
    maskRegions = await Promise.all(promises);
    console.timeEnd('loadAutoMaskImage');
    plugin.loadMasks(maskRegions);
    console.time('applyInitialMask');
    await this.applyInitialMask(true, true, texts);
    console.timeEnd('applyInitialMask');
  }

  /**
   * 应用初始蒙版
   * @param maskId 蒙版ID
   */
  async applyInitialMask(needHistory = false, isReset = false, texts: string[] = []) {
    const plugin = this.getMaskRegionPlugin();
    if (!plugin) return;
    await plugin.applyInitialMask(
      'merged_mask.png',
      this.originEditor?.objectManager.getAllObjects()[0] as ImageObject,
      needHistory,
      isReset,
      texts,
    );
    this.setOffset(0);
    this.getOffsetPlugin()?.setPreMaskCanvasMap();
  }

  async resetMask() {
    if (this.initApplyMaskHistory) {
      const canvas = cloneCanvas(this.initApplyMaskHistory);
      const maskCanvas = (this.originEditor?.objectManager.getAllObjects()[0] as ImageObject)
        .maskCanvas;
      if (maskCanvas) {
        const ctx = maskCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        ctx.drawImage(canvas, 0, 0);
      }

      this.applyMask(canvas);
      this.originEditor?.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Reset mask');
      this.originEditor?.requestRender();
    }
  }

  setColorSelectionMode(mode: 'add' | 'remove') {
    const plugin = this.getColorSelectionPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  setColorSelectionContinuous(continuous: boolean) {
    const plugin = this.getColorSelectionPlugin();
    if (plugin) {
      plugin.setContinuous(continuous);
    }
  }

  clearMask(recordHistory = true) {
    const images = this.originEditor?.objectManager.getAllObjects();
    if (images?.length) {
      (images[0] as ImageObject).clearMask();
      if (recordHistory) {
        this.originEditor?.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Cleared mask`, true);
        this.applyMask((images[0] as ImageObject).maskCanvas as HTMLCanvasElement);
      }
      this.originEditor?.requestRender();
    }
  }

  /**
   * 设置蒙版区域模式
   * @param mode 蒙版区域模式
   */
  setMaskRegionMode(mode: 'add' | 'remove') {
    const plugin = this.getMaskRegionPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  /**
   * 设置偏移蒙版
   * @param offset 偏移量
   */
  setOffsetMask(offset: number, needRecord = false) {
    const plugin = this.getOffsetMaskPlugin();
    if (plugin) {
      plugin.setOffset(offset, needRecord);
    }
    this.emit('offsetMaskChange', { offset });
  }

  /**
   * 设置偏移
   */
  setOffset(offset: number, needRecord = false) {
    const plugin = this.getOffsetPlugin();
    if (plugin) {
      this.offsetValue = offset;
      plugin.setOffset(this.offsetValue, needRecord, this.smoothValue);
    }
    this.emit('offsetMaskChange', { offset });
    if (this.offsetValue === 0) {
      this.smoothValue = 0;
      this.emit('smoothChange', { val: 0 });
    }
  }

  setSmooth(val: number) {
    this.smoothValue = val;
    const plugin = this.getOffsetPlugin();
    if (plugin) {
      plugin.setOffset(this.offsetValue, true, this.smoothValue);
    }
    this.emit('smoothChange', { val });
  }

  /**
   * 检查提取蒙版
   * @param maskUrl
   * @returns 是否重叠
   */
  async checkSubjectExtractionMask(maskUrl: string) {
    const image = await loadImage(maskUrl);
    if (!image || !(image instanceof HTMLImageElement)) return false;
    const objects = this.originEditor?.objectManager.getAllObjects();
    const cur = objects?.[0] as ImageObject;
    if (cur) {
      const maskCanvas = cur.maskCanvas;
      if (maskCanvas) {
        const canvas = document.createElement('canvas');
        canvas.width = maskCanvas.width;
        canvas.height = maskCanvas.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const maskData = convertMaskToTransparent(imageData);
        ctx.putImageData(maskData, 0, 0);
        // 判断canvas和maskCanvas是否有重叠的像素
        const flag = hasOverlappingPixels(canvas, maskCanvas);
        return flag;
      }
    }
  }

  /**
   * 初始化提取蒙版
   * @param maskUrl
   */
  async initSubjectExtractionMask(maskUrl: string) {
    const objs = this.originEditor?.objectManager.getAllObjects();
    if (objs && objs.length) {
      objs.forEach(obj => {
        if (obj instanceof ImageObject) {
          if (!obj.maskCanvas) {
            const canvas = document.createElement('canvas');
            canvas.width = obj.width;
            canvas.height = obj.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            obj.maskCanvas = canvas;
            obj.maskCtx = ctx as CanvasRenderingContext2D;
            obj.hasMask = true;
            obj.setMaskOpacity(PLUGIN_DEFAULT_OPACITY || 0.5);
            obj.setMaskColor(PLUGIN_DEFAULT_COLOR || '#FF0000');
          }
        }
      });
    }
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      await plugin.initSubjectExtractionMask(maskUrl);
    }
  }

  /**
   * 设置提取蒙版模式
   * @param type
   */
  setSubjectExtractionMaskMode(type: 'fill' | 'outline') {
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      plugin.setSubjectExtractionMaskMode(type);
    }
  }

  /**
   * 设置提取蒙版
   */
  setSubjectExtractionMask(recordHistory: boolean = true) {
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      plugin.setSubjectExtractionMask(recordHistory);
    }
    if (!recordHistory && !this.initApplyMaskHistory) {
      const maskCanvas = (this.originEditor?.objectManager.getAllObjects()[0] as ImageObject)
        .maskCanvas;
      if (maskCanvas) {
        const c = document.createElement('canvas');
        c.width = maskCanvas.width;
        c.height = maskCanvas.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(maskCanvas, 0, 0);
        this.initApplyMaskHistory = c;
        this.isApplyInitMask = true;
        this.originEditor?.history?.setInitialState(this.originEditor?.getState());
        this.applyMask(c);
      }
    }
    this.setOffset(0);
    this.getOffsetPlugin()?.setPreMaskCanvasMap();
  }

  setOutlineMask(offset: number) {
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      plugin.setOutlineMask(offset);
    }
  }

  /**
   * 撤销
   */
  undo() {
    this.originEditor?.undo();
  }

  /**
   * 重做
   */
  redo() {
    this.originEditor?.redo();
  }

  /**
   * 获取蒙版结果
   */
  getMaskResult() {
    const images = this.originEditor?.objectManager.getAllObjects();
    if (images?.length) {
      const canvas = (images[0] as ImageObject).maskCanvas;
      if (canvas) {
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const ctx = c.getContext('2d')!;
        if (!ctx) {
          return null;
        }
        ctx.drawImage(canvas, 0, 0);
        return {
          mask: c.toDataURL(),
          image: (images[0] as ImageObject).getImage(),
        };
      }
    }
    return null;
  }

  /**
   * 销毁
   */
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
    this.offsetValue = 0;
    this.smoothValue = 0;
  }

  toggleStopEventListeners(bool: boolean) {
    this.originEditor?.toggleStopEventListeners(bool);
    this.previewEditor?.toggleStopEventListeners(bool);
  }
}
