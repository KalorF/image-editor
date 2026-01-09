// oxlint-disable-next-line filename-case
import { EditorType, ImageObject, createEditor } from '../index';
import {
  ColorSelectionPlugin,
  EdgeExtractionMaskPlugin,
  GridPlugin,
  MaskBrushPlugin,
  MaskRegionPlugin,
  OffsetMaskPlugin,
  PreviewMaskPlugin,
  ResizeZoomPlugin,
  SubjectExtractionMaskPlugin,
} from '../plugins';
import { EditorEvents, EditorHooks, EditorTool } from '../types';
import { convertMaskToTransparent } from '../utils/math';
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

export class ProcessLayeredApp extends EventEmitter {
  private editor: EditorType | undefined;
  private initalMaskCanvas: HTMLCanvasElement | null = null;

  options: {
    minZoom: number;
    maxZoom: number;
    colorSelectionCursor?: string;
    pickAddIcon?: string;
    pickRemoveIcon?: string;
  };

  constructor(options?: {
    minZoom?: number;
    maxZoom?: number;
    colorSelectionCursor?: string;
    pickAddIcon?: string;
    pickRemoveIcon?: string;
  }) {
    super();
    this.options = {
      minZoom: options?.minZoom ?? 0.05,
      maxZoom: options?.maxZoom ?? 100,
      colorSelectionCursor: options?.colorSelectionCursor ?? 'crosshair',
      pickAddIcon: options?.pickAddIcon ?? 'crosshair',
      pickRemoveIcon: options?.pickRemoveIcon ?? 'crosshair',
    };
  }

  mount(canvas: HTMLElement) {
    this.editor = createEditor({
      container: canvas,
      enableHistory: true,
      enableSelection: false,
      enableHistoryHotkeys: false,
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
        new PreviewMaskPlugin(),
        new SubjectExtractionMaskPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
        }),
        new ColorSelectionPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
          colorSelectionCursor: this.options.colorSelectionCursor,
          pickAddIcon: this.options.pickAddIcon,
          pickRemoveIcon: this.options.pickRemoveIcon,
        }),
        new EdgeExtractionMaskPlugin({
          color: PLUGIN_DEFAULT_COLOR,
          opacity: PLUGIN_DEFAULT_OPACITY,
        }),
      ],
      zoomOptions: {
        minZoom: this.options.minZoom,
        maxZoom: this.options.maxZoom,
      },
    });
    this.bindEvents();
  }

  /**
   * 生成初始化蒙版canvas
   * @param maskCanvas
   * @returns
   */
  private generateInitalMaskCanvas(maskCanvas: HTMLCanvasElement) {
    const canvas = document.createElement('canvas');
    canvas.width = maskCanvas.width;
    canvas.height = maskCanvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();
    this.initalMaskCanvas = canvas;
  }

  getInitalMaskCanvas() {
    return this.initalMaskCanvas;
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.editor?.getCanvasElement() as HTMLCanvasElement;
  }

  bindEvents() {
    this.editor?.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit('zoomChange', { zoom });
    });

    this.editor?.on(EditorEvents.HISTORY_STATE_CHANGED, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo });
    });

    this.editor?.on(EditorEvents.HISTORY_UNDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo, isByRedoUndo: true });
    });

    this.editor?.on(EditorEvents.HISTORY_REDO, ({ canUndo, canRedo }) => {
      this.emit('historyChange', { canUndo, canRedo, isByRedoUndo: true });
    });
  }

  async setImage(src: string) {
    await this.editor?.importByJson([{ src, type: 'image' }]);
  }

  /**
   * 放大
   */
  zoomIn() {
    this.editor?.zoomIn();
  }

  /**
   * 缩小
   */
  zoomOut() {
    this.editor?.zoomOut();
  }

  /**
   * 缩放
   * @param zoom 缩放比例
   */
  zoomTo(zoom: number) {
    this.editor?.zoomTo(zoom);
  }

  /**
   * 缩放适应
   */
  zoomToFit() {
    this.editor?.zoomToFit();
  }

  resetZoom() {
    this.editor?.viewport.updateSize();
  }

  undo() {
    this.editor?.undo();
  }

  redo() {
    this.editor?.redo();
  }

  private getMaskBrushPlugin() {
    return this.editor?.plugins.getPlugin('maskBrush') as MaskBrushPlugin;
  }

  private getMaskRegionPlugin() {
    return this.editor?.plugins.getPlugin('maskRegion') as MaskRegionPlugin;
  }

  private getOffsetMaskPlugin() {
    return this.editor?.plugins.getPlugin('offsetMask') as OffsetMaskPlugin;
  }

  private getPreviewMaskPlugin() {
    return this.editor?.plugins.getPlugin('previewMask') as PreviewMaskPlugin;
  }

  private getSubjectExtractionMaskPlugin() {
    return this.editor?.plugins.getPlugin('subjectExtractionMask') as SubjectExtractionMaskPlugin;
  }

  private getColorSelectionPlugin() {
    return this.editor?.plugins.getPlugin('colorSelection') as ColorSelectionPlugin;
  }

  private getEdgeExtractionMaskPlugin() {
    return this.editor?.plugins.getPlugin('edgeExtractionMask') as EdgeExtractionMaskPlugin;
  }

  /**
   * 设置工具
   * @param tool 工具
   */
  setTool(tool: EditorTool) {
    this.editor?.setTool(tool);
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

  async loadAutoMaskImage(srcs: { src: string; name: string }[]) {
    const plugin = this.getMaskRegionPlugin();
    let maskRegions: any[] = [];
    const promises = [];
    for (let i = 0; i < srcs.length; i++) {
      const { src, name } = srcs[i];
      promises.push(plugin.createMaskRegionFromImage(name, name, src));
    }
    maskRegions = await Promise.all(promises);
    plugin.loadMasks(maskRegions);
  }

  setAppliedRegions(ids: string[]) {
    const plugin = this.getMaskRegionPlugin();
    if (!plugin) return;
    plugin.setAppliedRegions(this.editor?.objectManager.getAllObjects()[0] as ImageObject, ids);
  }

  async setInitialAppliedRegions() {
    const plugin = this.getMaskRegionPlugin();
    if (!plugin) return;
    await plugin.setInitialAppliedRegions();
  }

  hasAppliedRegionsResult() {
    const plugin = this.getMaskRegionPlugin();
    if (!plugin) return false;
    return plugin.getMaskRegionsSize() > 0;
  }

  async applyInitialMask(needHistory = false, isReset = false, texts: string[] = []) {
    const plugin = this.getMaskRegionPlugin();
    if (!plugin) return;
    await plugin.applyInitialMask(
      'merged_mask.png',
      this.editor?.objectManager.getAllObjects()[0] as ImageObject,
      needHistory,
      isReset,
      texts,
    );
    this.setOffsetMask(0);
    this.getOffsetMaskPlugin()?.setPreMaskCanvasMap();
  }

  /**
   * 清除所有图像的蒙版
   */
  clearMask(recordHistory = true) {
    const objects = this.editor?.objectManager.getAllObjects();
    if (objects && objects.length) {
      objects.forEach(obj => {
        if (obj instanceof ImageObject) {
          obj.clearMask();
        }
      });
      if (recordHistory) {
        this.editor?.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Cleared mask`, true);
        this.editor?.requestRender();
      }
    }
  }

  /**
   * 重置mask
   */
  async resetMask(maskBase64?: string) {
    const objs = this.editor?.objectManager.getAllObjects();
    if (objs && objs.length) {
      let image: HTMLImageElement | null = null;
      if (maskBase64) {
        image = (await loadImage(maskBase64)) as HTMLImageElement | null;
        if (!image || !(image instanceof HTMLImageElement)) return;
      }
      objs.forEach(obj => {
        if (obj instanceof ImageObject) {
          if (!obj.hasMask) {
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = obj.width;
            maskCanvas.height = obj.height;
            const maskCtx = maskCanvas.getContext('2d');
            obj.maskCanvas = maskCanvas;
            obj.maskCtx = maskCtx as CanvasRenderingContext2D;
            obj.hasMask = true;
          }
          if (obj.hasMask) {
            const maskCanvas = obj.maskCanvas;
            if (!maskCanvas) return;
            const maskCtx = obj.maskCtx;
            if (maskCtx) {
              if (image) {
                maskCtx.drawImage(image, 0, 0);
                const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
                const maskData = convertMaskToTransparent(imageData);
                maskCtx.putImageData(maskData, 0, 0);
              } else {
                maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                maskCtx.fillStyle = '#ffffff';
                maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
              }
            }
          }
          obj.setMaskOpacity(PLUGIN_DEFAULT_OPACITY || 0.5);
          obj.setMaskColor(PLUGIN_DEFAULT_COLOR || '#FF0000');
        }
      });
      this.editor?.hooks.trigger(EditorHooks.HISTORY_CAPTURE, `Reset mask`, true);
      this.editor?.requestRender();
    }
  }

  /**
   * 新增操作
   */
  async addInitialMask(maskBase64?: string) {
    if (maskBase64) {
      const objects = this.editor?.objectManager.getAllObjects();
      if (objects && objects.length) {
        for (let i = 0; i < objects.length; i++) {
          const obj = objects[i];
          if (obj instanceof ImageObject) {
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = obj.width;
            maskCanvas.height = obj.height;
            const image = await loadImage(maskBase64);
            if (!image || !(image instanceof HTMLImageElement)) return;
            const ctx = maskCanvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(image, 0, 0, obj.width, obj.height);
            const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            const maskData = convertMaskToTransparent(imageData);
            ctx.putImageData(maskData, 0, 0);
            obj.maskCanvas = maskCanvas;
            obj.maskCtx = ctx;
            obj.hasMask = true;
            this.generateInitalMaskCanvas(maskCanvas);
            obj.setMaskOpacity(PLUGIN_DEFAULT_OPACITY || 0.5);
            obj.setMaskColor(PLUGIN_DEFAULT_COLOR || '#FF0000');
          }
        }
        this.editor?.history?.setInitialState(this.editor?.getState());
        this.editor?.requestRender();
      }
      return;
    }
    const objects = this.editor?.objectManager.getAllObjects();
    if (objects && objects.length) {
      objects.forEach(obj => {
        if (obj instanceof ImageObject) {
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = obj.width;
          maskCanvas.height = obj.height;
          const maskCtx = maskCanvas.getContext('2d');
          obj.maskCanvas = maskCanvas;
          obj.maskCtx = maskCtx as CanvasRenderingContext2D;
          if (maskCtx) {
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.fillStyle = '#ffffff';
            maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
          }
          obj.hasMask = true;
          this.generateInitalMaskCanvas(maskCanvas);
          obj.setMaskOpacity(PLUGIN_DEFAULT_OPACITY || 0.5);
          obj.setMaskColor(PLUGIN_DEFAULT_COLOR || '#FF0000');
        }
      });
      this.editor?.history?.setInitialState(this.editor?.getState());
      this.editor?.requestRender();
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
   * 设置预览蒙版
   * @param isPreviewMask
   */
  setPreviewMask(isPreviewMask: boolean) {
    const plugin = this.getPreviewMaskPlugin();
    if (plugin) {
      if (isPreviewMask) {
        this.editor?.toggleDisableAllTools(true);
      } else {
        this.editor?.toggleDisableAllTools(false);
      }
      plugin.setPreviewMask(isPreviewMask);
    }
  }

  /**
   * 检查提取蒙版
   * @param maskUrl
   * @returns 是否重叠
   */
  async checkSubjectExtractionMask(maskUrl: string) {
    const image = await loadImage(maskUrl);
    if (!image || !(image instanceof HTMLImageElement)) return false;
    const objects = this.editor?.objectManager.getAllObjects();
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
  async initSubjectExtractionMask(maskUrl: string, isReset: boolean = false) {
    const objs = this.editor?.objectManager.getAllObjects();
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
      await plugin.initSubjectExtractionMask(maskUrl, isReset);
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
  setSubjectExtractionMask() {
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      plugin.setSubjectExtractionMask();
    }
    // if (this.getOffsetMaskPlugin()) {
    //   this.setOffsetMask(0);
    //   this.getOffsetMaskPlugin()?.setPreMaskCanvasMap();
    // }
  }

  /**
   * 初始化边缘提取蒙版
   */
  async initEdgeExtractionMask(maskUrl: string) {
    const objs = this.editor?.objectManager.getAllObjects();
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
    const plugin = this.getEdgeExtractionMaskPlugin();
    if (plugin) {
      await plugin.initEdgeExtractionMask(maskUrl);
    }
  }

  /**
   * 设置边缘提取蒙版
   */
  setEdgeExtractionMask() {
    const plugin = this.getEdgeExtractionMaskPlugin();
    if (plugin) {
      plugin.setEdgeExtractionMask();
    }
  }
  /**
   * 设置颜色选择模式
   * @param mode 颜色选择模式
   */
  setColorSelectionMode(mode: 'add' | 'remove') {
    const plugin = this.getColorSelectionPlugin();
    if (plugin) {
      plugin.setMode(mode);
    }
  }

  /**
   * 设置轮廓蒙版
   * @param offset 偏移量
   */
  setOutlineMask(offset: number) {
    const plugin = this.getSubjectExtractionMaskPlugin();
    if (plugin) {
      plugin.setOutlineMask(offset);
    }
  }

  /**
   * 设置颜色选择连续
   * @param continuous 是否连续
   */
  setColorSelectionContinuous(continuous: boolean) {
    const plugin = this.getColorSelectionPlugin();
    if (plugin) {
      plugin.setContinuous(continuous);
    }
  }

  /**
   * 获取蒙版结果
   * @returns 蒙版结果
   */
  getMaskResult() {
    const images = this.editor?.objectManager.getAllObjects();
    const image = images?.[0] as ImageObject | undefined;
    if (image) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (image.maskCanvas) {
        ctx.drawImage(image.maskCanvas, 0, 0);
      }
      ctx.restore();
      return canvas;
    }
  }

  /**
   * 设置手势激活
   * @param active 是否激活
   */
  setHandActive(active: boolean) {
    this.editor?.setSpacePressed(active);
  }

  toggleStopEventListeners(bool: boolean) {
    this.editor?.toggleStopEventListeners(bool);
  }

  destroy() {
    this.editor?.destroy();
    this.removeAllListeners();
    this.editor = undefined;
  }
}
