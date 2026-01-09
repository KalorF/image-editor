// oxlint-disable-next-line filename-case
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { EditorEvents, EditorHooks, EditorTools, type Plugin } from '../types';
import { cloneCanvas, convertMaskToTransparent } from '../utils/math';

const loadImage = (src: string): Promise<HTMLImageElement | null> => {
  return new Promise((resolve, _reject) => {
    const image = new Image();
    image.src = src;
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      resolve(null);
    };
  });
};

export class EdgeExtractionMaskPlugin implements Plugin<Editor> {
  name = 'edgeExtractionMask';
  version = '1.0.0';

  private editor!: Editor;
  private subjectMap: Record<
    string,
    {
      fillCanvas: HTMLCanvasElement;
      initialMaskCanvas: HTMLCanvasElement;
    }
  > = {};
  private options: {
    color: string;
    opacity: number;
    mode: 'fill' | 'outline';
  };

  constructor(options: { color: string; opacity: number }) {
    this.options = {
      ...options,
      mode: 'fill',
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    this.registerEventHooks();
  }

  private registerEventHooks(): void {
    this.editor.on(EditorEvents.TOOL_CHANGED, this.onToolChanged);
    // this.editor.on(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
  }

  uninstall(_editor: Editor): void {
    this.editor.off(EditorEvents.TOOL_CHANGED, this.onToolChanged);
    // this.editor.off(EditorEvents.CANVAS_CURSOR_UPDATED, this.onCanvasCursorUpdated);
  }

  private onToolChanged = () => {
    const currentTool = this.editor.getTool();
    if (currentTool === EditorTools.EXTRACT_MASK) {
      this.editor.updateCanvasCursor('default');
    }
  };

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

      imageObj.setMaskOpacity(this.options.opacity || 0.5);
      imageObj.setMaskColor(this.options.color || '#FF0000');
    }
  }

  async initEdgeExtractionMask(maskUrl: string) {
    const objs = this.editor.objectManager.getAllObjects();
    const image = await loadImage(maskUrl);
    if (!image) return;
    for (const obj of objs) {
      if (obj.type === 'image') {
        const id = obj.id;

        this.ensureImageHasMask(obj as ImageObject);
        // 创建填充 canvas
        const fillCanvas = document.createElement('canvas');
        const width = (obj as ImageObject).getImage().width;
        const height = (obj as ImageObject).getImage().height;
        fillCanvas.width = width;
        fillCanvas.height = height;
        const fillCtx = fillCanvas.getContext('2d');
        if (!fillCtx) continue;
        fillCtx.drawImage(image, 0, 0, width, height);
        const imageData = fillCtx.getImageData(0, 0, width, height);
        const maskData = convertMaskToTransparent(imageData);
        fillCtx.putImageData(maskData, 0, 0);

        this.subjectMap[id] = {
          initialMaskCanvas: cloneCanvas((obj as ImageObject).maskCanvas as HTMLCanvasElement),
          fillCanvas,
        };
      }
    }
  }

  setEdgeExtractionMask() {
    if (this.editor.disableAllTools) return;
    const objs = this.editor.objectManager.getAllObjects();
    // const type = this.options.mode;
    for (const obj of objs) {
      if (obj.type === 'image') {
        const id = obj.id;

        (obj as ImageObject).maskCanvas = cloneCanvas(this.subjectMap[id].initialMaskCanvas);
        const maskCanvas = (obj as ImageObject).maskCanvas;
        (obj as ImageObject).maskCtx = maskCanvas?.getContext('2d') || undefined;
        (obj as ImageObject).hasMask = true;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = maskCanvas?.width || 0;
        tempCanvas.height = maskCanvas?.height || 0;
        const maskCtx = maskCanvas?.getContext('2d');
        if (!maskCtx) continue;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) continue;
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.save();
        tempCtx.drawImage(this.subjectMap[id].fillCanvas, 0, 0);
        tempCtx.restore();
        maskCtx.save();
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.drawImage(tempCanvas, 0, 0);
        maskCtx.restore();
      }
    }

    this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'extraction mask applied');
    this.editor.requestRender();
  }
}
