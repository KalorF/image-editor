// oxlint-disable filename-case
import { Editor } from '../Editor';
import { Potrace } from '../lib/index';
import { ImageObject } from '../objects/ImageObject';
import { EditorHooks, type Plugin } from '../types';
import { cloneCanvas } from '../utils/math';

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

export class OffsetPlugin implements Plugin<Editor> {
  name = 'offset';
  version = '1.0.0';

  private editor!: Editor;
  offset: number = 0;
  smoothValue: number = 0;

  private preMaskCanvasMap: Record<string, HTMLCanvasElement> | null = null;

  constructor(offset: number = 0) {
    this.offset = offset;
  }

  install(editor: Editor): void {
    this.editor = editor;
  }

  resetOffset() {
    this.offset = 0;
  }

  setPreMaskCanvasMap() {
    const objs = this.editor.objectManager.getAllObjects();
    const preMaskCanvasMap: Record<string, HTMLCanvasElement> = {};
    if (objs.length === 0) {
      return;
    }
    for (const obj of objs) {
      if (obj.type === 'image') {
        const canvas = (obj as ImageObject).maskCanvas;
        if (canvas) {
          preMaskCanvasMap[obj.id] = cloneCanvas(canvas) as HTMLCanvasElement;
        }
      }
    }
    this.preMaskCanvasMap = preMaskCanvasMap;
  }

  /**
   * 使用形态学操作对蒙版进行偏移处理
   * @param maskCanvas 源蒙版 canvas
   * @param offset 偏移值，正值向外膨胀，负值向内腐蚀
   * @returns 处理后的 canvas
   */
  private applyMorphologicalOffset(
    maskCanvas: HTMLCanvasElement,
    offset: number,
  ): HTMLCanvasElement {
    const { width, height } = maskCanvas;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return maskCanvas;

    // 获取原始像素数据
    const originalData = ctx.getImageData(0, 0, width, height);
    const original = originalData.data;
    const totalPixels = width * height;

    // 构建灰度蒙版（提取 alpha 通道）
    const grayMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      grayMask[i] = original[i * 4 + 3];
    }

    // 根据偏移值选择操作
    const iterations = Math.abs(offset);
    let resultMask: Uint8Array;

    if (offset > 0) {
      // 正偏移：向外膨胀
      resultMask = dilateSoftOptimized(grayMask, width, height, iterations);
    } else if (offset < 0) {
      // 负偏移：向内腐蚀
      resultMask = erodeSoftOptimized(grayMask, width, height, iterations);
    } else {
      // 偏移为0，直接返回原蒙版
      resultMask = grayMask;
    }

    // 创建结果 canvas
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = width;
    resultCanvas.height = height;
    const resultCtx = resultCanvas.getContext('2d');
    if (!resultCtx) return maskCanvas;

    // 将处理后的蒙版数据转换为 RGBA 数据
    const resultData = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const pixelIdx = i * 4;
      const alpha = resultMask[i];
      if (alpha > 0) {
        // 保持原始颜色，只修改透明度
        resultData[pixelIdx] = original[pixelIdx]; // R
        resultData[pixelIdx + 1] = original[pixelIdx + 1]; // G
        resultData[pixelIdx + 2] = original[pixelIdx + 2]; // B
        resultData[pixelIdx + 3] = alpha; // A
      } else {
        // 透明像素
        resultData[pixelIdx] = 0;
        resultData[pixelIdx + 1] = 0;
        resultData[pixelIdx + 2] = 0;
        resultData[pixelIdx + 3] = 0;
      }
    }

    // 将结果数据写入 canvas
    const resultImageData = new ImageData(resultData, width, height);
    resultCtx.putImageData(resultImageData, 0, 0);

    return resultCanvas;
  }

  /**
   * 使用 Potrace 算法从 canvas 提取 SVG 路径，忽略透明像素
   * @param canvas 源 canvas
   * @returns SVG path 字符串
   */
  private extractPathFromCanvas(canvas: HTMLCanvasElement, smoothValue: number): string {
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 只改调用方式：反相 alpha，让 Potrace 追踪“不透明主体”
    const data = new Uint8ClampedArray(imageData.data); // 拷贝，避免污染原图
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255 - data[i];
    }

    this.applyPotraceSmoothParams(smoothValue);
    Potrace.loadImageFromGrayAlpha(data, canvas.width, canvas.height);
    Potrace.process();

    const pathString = Potrace.getTransformPath(1, 0, 0, 1, 1);

    return pathString;
  }

  // 把 UI 1~10 映射成 Potrace 参数（更敏感、更稳定）
  private applyPotraceSmoothParams(uiLevel: number) {
    const t0 = Number.isFinite(uiLevel) ? uiLevel : 1;
    const t = Math.max(1, Math.min(10, t0));
    const r = (t - 1) / 9;

    // 让低档位也有变化（smoothstep）
    const eased = r * r * (3 - 2 * r);

    // alphamax 常用 0~1.33；这里避免 0 太“硬”
    const alphamax = 0.6 + eased * (1.33 - 0.6);

    // opttolerance 越大越“简化/平滑”，变化更直观
    const opttolerance = 0.05 + eased * (0.6 - 0.05);

    Potrace.setParameter({
      optcurve: true,
      alphamax,
      opttolerance,
    });
  }

  private drawPathToCanvas(
    ctx: CanvasRenderingContext2D,
    pathString: string,
    fillStyle: string = 'rgba(255, 255, 255, 1)',
  ): void {
    if (!pathString || pathString.trim() === '') {
      return;
    }

    try {
      // 使用 Path2D API 创建路径
      const path2D = new Path2D(pathString);

      // 设置填充样式
      ctx.fillStyle = fillStyle;

      // 只填充路径内部区域，不绘制边框
      ctx.fill(path2D, 'evenodd');
    } catch (error) {
      console.error('Failed to draw path to canvas:', error);
      console.error('Path string:', pathString.substring(0, 200)); // 只输出前200个字符
    }
  }

  setOffset(offset: number, needRecord = false, smoothValue: number) {
    this.offset = offset;
    this.smoothValue = smoothValue;

    if (this.offset === 0 && !needRecord) {
      return;
    }

    if (this.preMaskCanvasMap && Object.keys(this.preMaskCanvasMap).length) {
      for (const [id, canvas] of Object.entries(this.preMaskCanvasMap)) {
        // 使用形态学操作应用偏移
        const offsetMaskCanvas = this.applyMorphologicalOffset(canvas, this.offset);

        let pathString = '';
        if (this.smoothValue > 0) {
          pathString = this.extractPathFromCanvas(offsetMaskCanvas, this.smoothValue);
        }

        // 获取对应的图像对象并更新蒙版
        const obj = this.editor.objectManager.getObjectById(id);
        if (obj && obj.type === 'image') {
          const imageObj = obj as ImageObject;
          if (imageObj.maskCanvas) {
            const ctx = imageObj.maskCanvas.getContext('2d');

            if (ctx) {
              // 保存上下文状态
              ctx.save();

              // 清空现有蒙版
              ctx.globalCompositeOperation = 'source-over';
              ctx.clearRect(0, 0, imageObj.maskCanvas.width, imageObj.maskCanvas.height);

              if (pathString) {
                this.drawPathToCanvas(ctx, pathString);
              } else {
                // 绘制偏移后的蒙版
                ctx.drawImage(offsetMaskCanvas, 0, 0);
              }

              // 恢复上下文状态
              ctx.restore();
            }

            // 更新 hasMask 标志
            imageObj.hasMask = true;
          }
        }
      }
      if (needRecord) {
        this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Offset mask', true);
      }
      // 触发渲染
      this.editor.requestRender();
    }
  }
}
