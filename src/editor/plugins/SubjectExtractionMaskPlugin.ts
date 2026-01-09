// oxlint-disable-next-line filename-case
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { EditorEvents, EditorHooks, EditorTools, type Plugin } from '../types';
import { cloneCanvas, convertMaskToTransparent } from '../utils/math';

/**
 * 计算两个蒙版的差集：保留 maskA 中有但 maskB 中没有的像素
 * @param maskA 被减数蒙版
 * @param maskB 减数蒙版
 * @returns 差集结果的新 canvas
 */
const subtractMask = (maskA: HTMLCanvasElement, maskB: HTMLCanvasElement): HTMLCanvasElement => {
  const width = maskA.width;
  const height = maskA.height;

  // 创建结果 canvas
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = width;
  resultCanvas.height = height;
  const resultCtx = resultCanvas.getContext('2d');
  if (!resultCtx) return maskA;

  // 获取两个蒙版的像素数据
  const ctxA = maskA.getContext('2d');
  const ctxB = maskB.getContext('2d');
  if (!ctxA || !ctxB) return maskA;

  const dataA = ctxA.getImageData(0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height);
  const pixelsA = dataA.data;
  const pixelsB = dataB.data;

  // 创建结果数据
  const resultData = new Uint8ClampedArray(pixelsA.length);

  // 阈值：alpha 大于此值视为不透明
  const ALPHA_THRESHOLD = 127;

  // 遍历每个像素
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const alphaA = pixelsA[idx + 3];
    const alphaB = pixelsB[idx + 3];

    // 差集逻辑：A 有且 B 没有的像素保留
    if (alphaA > ALPHA_THRESHOLD && alphaB <= ALPHA_THRESHOLD) {
      // 保留 A 的像素
      resultData[idx] = pixelsA[idx]; // R
      resultData[idx + 1] = pixelsA[idx + 1]; // G
      resultData[idx + 2] = pixelsA[idx + 2]; // B
      resultData[idx + 3] = pixelsA[idx + 3]; // A
    } else {
      // 其他情况设为透明
      resultData[idx] = 0;
      resultData[idx + 1] = 0;
      resultData[idx + 2] = 0;
      resultData[idx + 3] = 0;
    }
  }

  // 将结果写入 canvas
  const resultImageData = new ImageData(resultData, width, height);
  resultCtx.putImageData(resultImageData, 0, 0);

  return resultCanvas;
};

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

// 高性能：从蒙版中提取轮廓（优化版）
const extractOutlineFromMask = (
  maskCanvas: HTMLCanvasElement,
  thickness: number = -5,
): HTMLCanvasElement => {
  const { width, height } = maskCanvas;
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return maskCanvas;

  const originalData = ctx.getImageData(0, 0, width, height);
  const original = originalData.data;
  const totalPixels = width * height;

  // 步骤1：构建灰度蒙版（优化：使用 TypedArray 批量操作）
  const grayMask = new Uint8Array(totalPixels);
  // 优化：一次循环提取 alpha，避免多次索引计算
  for (let i = 0; i < totalPixels; i++) {
    grayMask[i] = original[i * 4 + 3];
  }

  // 步骤2：使用软形态学操作
  const iterations = Math.abs(thickness);
  const isInner = thickness < 0;

  let outlineMask: Uint8Array;

  if (isInner) {
    const erodedMask = erodeSoftOptimized(grayMask, width, height, iterations);
    outlineMask = subtractMasksSoft(grayMask, erodedMask, width, height);
  } else {
    const dilatedMask = dilateSoftOptimized(grayMask, width, height, iterations);
    outlineMask = subtractMasksSoft(dilatedMask, grayMask, width, height);
  }

  // 步骤3：转换为 RGBA 数据（优化：减少条件判断）
  const edgeData = new Uint8ClampedArray(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const pixelIdx = i * 4;
    const alpha = outlineMask[i];
    // 优化：使用位运算和批量赋值
    if (alpha > 0) {
      edgeData[pixelIdx] = 255;
      edgeData[pixelIdx + 1] = 255;
      edgeData[pixelIdx + 2] = 255;
      edgeData[pixelIdx + 3] = alpha;
    }
  }

  // 步骤4：自适应超采样 + 优化模糊
  // 优化：根据图像大小动态调整超采样倍数
  // 2048x2048 使用 2x，1024x1024 使用 4x，更小的使用 8x
  let SS = 8;
  if (width >= 2048 || height >= 2048) {
    SS = 2; // 大图像使用较小倍数
  } else if (width >= 1024 || height >= 1024) {
    SS = 4;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d', {
    willReadFrequently: false, // 优化：提示浏览器优化
  });
  if (!tempCtx) return maskCanvas;

  const tempImageData = new ImageData(edgeData, width, height);
  tempCtx.putImageData(tempImageData, 0, 0);

  // 超采样放大
  const upCanvas = document.createElement('canvas');
  upCanvas.width = width * SS;
  upCanvas.height = height * SS;
  const upCtx = upCanvas.getContext('2d', {
    willReadFrequently: false,
  });
  if (!upCtx) return maskCanvas;

  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = 'high';
  upCtx.drawImage(tempCanvas, 0, 0, upCanvas.width, upCanvas.height);

  // 优化：合并模糊操作，减少 canvas 创建
  // 在高分辨率下只进行一次模糊，然后直接缩放
  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = width;
  outlineCanvas.height = height;
  const outlineCtx = outlineCanvas.getContext('2d', {
    alpha: true,
    willReadFrequently: false,
  });
  if (!outlineCtx) return maskCanvas;

  // 优化：根据超采样倍数调整模糊半径
  // 2x 使用 2px，4x 使用 3px，8x 使用 4px
  // oxlint-disable-next-line no-nested-ternary
  const blurRadius = SS === 2 ? 2 : SS === 4 ? 3 : 4;

  // 在高分辨率下进行一次模糊
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = upCanvas.width;
  blurCanvas.height = upCanvas.height;
  const blurCtx = blurCanvas.getContext('2d', {
    willReadFrequently: false,
  });
  if (!blurCtx) return maskCanvas;

  blurCtx.imageSmoothingEnabled = true;
  blurCtx.imageSmoothingQuality = 'high';
  blurCtx.filter = `blur(${blurRadius}px)`;
  blurCtx.drawImage(upCanvas, 0, 0);

  // 直接缩回原尺寸
  outlineCtx.imageSmoothingEnabled = true;
  outlineCtx.imageSmoothingQuality = 'high';
  outlineCtx.filter = 'none';
  outlineCtx.drawImage(blurCanvas, 0, 0, width, height);

  return outlineCanvas;
};

/**
 * 软蒙版差集：保留灰度信息
 */
function subtractMasksSoft(
  maskA: Uint8Array,
  maskB: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const result = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    // 差集：A - B，确保不小于0
    result[i] = Math.max(0, maskA[i] - maskB[i]);
  }

  return result;
}

/**
 * 优化的软腐蚀操作：减少内存分配和循环开销
 */
function erodeSoftOptimized(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number,
): Uint8Array {
  if (iterations === 0) return new Uint8Array(mask);

  let current = new Uint8Array(mask);
  const totalPixels = width * height;

  // 优化：预分配所有需要的数组，避免每次迭代都创建
  const horizontal = new Uint8Array(totalPixels);
  let next = new Uint8Array(totalPixels);

  for (let iter = 0; iter < iterations; iter++) {
    // 水平滤波
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;

      // 左边界
      horizontal[rowOffset] = 0;

      // 中间区域（优化：减少边界检查）
      if (width > 2) {
        // 使用 SIMD 友好的循环展开
        for (let x = 1; x < width - 1; x++) {
          const idx = rowOffset + x;
          horizontal[idx] = Math.min(current[idx - 1], current[idx], current[idx + 1]);
        }
      }

      // 右边界
      if (width > 1) {
        horizontal[rowOffset + width - 1] = 0;
      }
    }

    // 垂直滤波
    // 第一行
    for (let x = 0; x < width; x++) {
      next[x] = 0;
    }

    // 中间行（优化：减少计算）
    if (height > 2) {
      for (let y = 1; y < height - 1; y++) {
        const rowOffset = y * width;
        const prevRowOffset = rowOffset - width;
        const nextRowOffset = rowOffset + width;

        for (let x = 0; x < width; x++) {
          next[rowOffset + x] = Math.min(
            horizontal[prevRowOffset + x],
            horizontal[rowOffset + x],
            horizontal[nextRowOffset + x],
          );
        }
      }
    }

    // 最后一行
    if (height > 1) {
      const lastRowOffset = (height - 1) * width;
      for (let x = 0; x < width; x++) {
        next[lastRowOffset + x] = 0;
      }
    }

    // 交换引用，避免复制
    [current, next] = [next, current];
  }

  return current;
}

/**
 * 优化的软膨胀操作：减少内存分配和循环开销
 */
function dilateSoftOptimized(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number,
): Uint8Array {
  if (iterations === 0) return new Uint8Array(mask);

  let current = new Uint8Array(mask);
  const totalPixels = width * height;

  // 优化：预分配数组
  const horizontal = new Uint8Array(totalPixels);
  let next = new Uint8Array(totalPixels);

  for (let iter = 0; iter < iterations; iter++) {
    // 水平滤波
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;

      // 左边界
      if (width > 1) {
        horizontal[rowOffset] = Math.max(current[rowOffset], current[rowOffset + 1]);
      } else {
        horizontal[rowOffset] = current[rowOffset];
      }

      // 中间区域
      if (width > 2) {
        for (let x = 1; x < width - 1; x++) {
          const idx = rowOffset + x;
          horizontal[idx] = Math.max(current[idx - 1], current[idx], current[idx + 1]);
        }
      }

      // 右边界
      if (width > 1) {
        const lastIdx = rowOffset + width - 1;
        horizontal[lastIdx] = Math.max(current[lastIdx - 1], current[lastIdx]);
      }
    }

    // 垂直滤波
    // 第一行
    if (height > 1) {
      for (let x = 0; x < width; x++) {
        next[x] = Math.max(horizontal[x], horizontal[width + x]);
      }
    } else {
      next.set(horizontal);
    }

    // 中间行
    if (height > 2) {
      for (let y = 1; y < height - 1; y++) {
        const rowOffset = y * width;
        const prevRowOffset = rowOffset - width;
        const nextRowOffset = rowOffset + width;

        for (let x = 0; x < width; x++) {
          next[rowOffset + x] = Math.max(
            horizontal[prevRowOffset + x],
            horizontal[rowOffset + x],
            horizontal[nextRowOffset + x],
          );
        }
      }
    }

    // 最后一行
    if (height > 1) {
      const lastRowOffset = (height - 1) * width;
      const prevRowOffset = (height - 2) * width;
      for (let x = 0; x < width; x++) {
        next[lastRowOffset + x] = Math.max(
          horizontal[prevRowOffset + x],
          horizontal[lastRowOffset + x],
        );
      }
    }

    // 交换引用
    [current, next] = [next, current];
  }

  return current;
}

export class SubjectExtractionMaskPlugin implements Plugin<Editor> {
  name = 'subjectExtractionMask';
  version = '1.0.0';

  private editor!: Editor;
  private subjectMap: Record<
    string,
    {
      fillCanvas: HTMLCanvasElement;
      outlineCanvas: HTMLCanvasElement;
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

  async initSubjectExtractionMask(maskUrl: string, isReset: boolean = false) {
    const objs = this.editor.objectManager.getAllObjects();
    const currentId = objs[0].id;
    if (this.subjectMap[currentId] && this.subjectMap[currentId].fillCanvas && !isReset) {
      for (const obj of objs) {
        if (obj.type === 'image') {
          const id = obj.id;

          // 计算当前 maskCanvas 不包含 fillCanvas 得到新的区域
          let currentMaskCanvas = (obj as ImageObject).maskCanvas as HTMLCanvasElement;
          const fillCanvas = this.subjectMap[id].fillCanvas;

          if (!currentMaskCanvas) {
            const canvas = document.createElement('canvas');
            canvas.width = obj.width;
            canvas.height = obj.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(fillCanvas, 0, 0);
            currentMaskCanvas = canvas;
            (obj as ImageObject).maskCanvas = canvas;
            (obj as ImageObject).maskCtx = ctx;
            (obj as ImageObject).hasMask = true;
            (obj as ImageObject).setMaskOpacity(this.options.opacity || 0.5);
            (obj as ImageObject).setMaskColor(this.options.color || '#FF0000');
          }

          if (currentMaskCanvas && fillCanvas) {
            // 计算差集：currentMaskCanvas - fillCanvas
            const subtractedMask = subtractMask(currentMaskCanvas, fillCanvas);

            // 更新 initialMaskCanvas 为差集结果
            this.subjectMap[id] = {
              ...this.subjectMap[id],
              initialMaskCanvas: subtractedMask,
            };
          } else {
            // 如果没有 fillCanvas，直接克隆当前 maskCanvas
            if (currentMaskCanvas) {
              this.subjectMap[id] = {
                ...this.subjectMap[id],
                initialMaskCanvas: cloneCanvas(currentMaskCanvas),
              };
            }
          }
        }
      }
      return;
    }
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

        // 从填充 canvas 提取轮廓 canvas
        const outlineCanvas = extractOutlineFromMask(fillCanvas, -5);

        this.subjectMap[id] = {
          initialMaskCanvas: cloneCanvas((obj as ImageObject).maskCanvas as HTMLCanvasElement),
          fillCanvas,
          outlineCanvas,
        };
      }
    }
  }

  setOutlineMask(offset: number) {
    const objs = this.editor.objectManager.getAllObjects();
    for (const obj of objs) {
      if (obj.type === 'image') {
        const id = obj.id;
        const copyFillCanvas = cloneCanvas(this.subjectMap[id].fillCanvas);
        const outlineCanvas = extractOutlineFromMask(copyFillCanvas, offset);
        this.subjectMap[id].outlineCanvas = outlineCanvas;
      }
    }
  }

  setSubjectExtractionMaskMode(type: 'fill' | 'outline') {
    this.options.mode = type;
  }

  setSubjectExtractionMask(recordHistory: boolean = true) {
    if (this.editor.disableAllTools) return;
    const objs = this.editor.objectManager.getAllObjects();
    const type = this.options.mode;
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
        if (type === 'fill') {
          tempCtx.drawImage(this.subjectMap[id].fillCanvas, 0, 0);
        } else {
          tempCtx.drawImage(this.subjectMap[id].outlineCanvas, 0, 0);
        }
        tempCtx.restore();
        maskCtx.save();
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.drawImage(tempCanvas, 0, 0);
        maskCtx.restore();
      }
    }

    if (recordHistory) {
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'extraction mask applied');
    }
    this.editor.requestRender();
  }
}
