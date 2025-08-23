// 偏移蒙版插件
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { EditorHooks, type Plugin } from '../types';
import { cloneCanvas } from '../utils/math';

export class OffsetMaskPlugin implements Plugin<Editor> {
  name = 'offsetMask';
  version = '1.0.0';

  private editor!: Editor;
  private offset: number = 0;

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

  setOffset(offset: number) {
    this.offset = offset;

    if (this.offset === 0) {
      return;
    }

    if (this.preMaskCanvasMap && Object.keys(this.preMaskCanvasMap).length) {
      for (const [id, canvas] of Object.entries(this.preMaskCanvasMap)) {
        const curMask = cloneCanvas(canvas);

        // 应用偏移蒙版
        const offsetMask = this.applyOffsetMask(curMask, this.offset);

        // 找到对应的图像对象并更新蒙版
        const obj = this.editor.objectManager.getObjectById(id);
        if (obj && obj.type === 'image') {
          const imageObj = obj as ImageObject;
          if (imageObj.maskCanvas) {
            const ctx = imageObj.maskCanvas.getContext('2d')!;
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, imageObj.maskCanvas.width, imageObj.maskCanvas.height);
            ctx.drawImage(offsetMask, 0, 0);
            ctx.restore();
          }
        }
      }
      this.editor.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Offset mask', true);
      // 触发渲染
      this.editor.requestRender();
    }
  }

  /**
   * 应用偏移蒙版 - 使用高效的卷积核算法实现轮廓扩散
   * @param maskCanvas 原始蒙版画布
   * @param offset 偏移距离（正数向外扩散，负数向内收缩）
   * @returns 处理后的蒙版画布
   */
  private applyOffsetMask(maskCanvas: HTMLCanvasElement, offset: number): HTMLCanvasElement {
    const { width, height } = maskCanvas;
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = width;
    resultCanvas.height = height;
    const resultCtx = resultCanvas.getContext('2d')!;

    // 获取原始蒙版数据
    const srcCtx = maskCanvas.getContext('2d')!;
    const imageData = srcCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    if (offset > 0) {
      // 向外扩散：使用优化的膨胀算法
      this.fastDilateMask(data, width, height, offset);
    } else if (offset < 0) {
      // 向内收缩：使用优化的腐蚀算法
      this.fastErodeMask(data, width, height, Math.abs(offset));
    }

    // 将处理后的数据绘制到结果画布
    const resultImageData = new ImageData(data, width, height);
    resultCtx.putImageData(resultImageData, 0, 0);

    return resultCanvas;
  }

  /**
   * 快速膨胀算法 - 使用距离变换和阈值处理
   * @param data 像素数据
   * @param width 画布宽度
   * @param height 画布高度
   * @param radius 膨胀半径
   */
  private fastDilateMask(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
  ): void {
    // 创建距离变换数组
    const distanceMap = new Float32Array(width * height);

    // 计算每个像素到最近有颜色像素的距离
    this.computeDistanceTransform(data, distanceMap, width, height, true);

    // 根据距离设置透明度
    for (let i = 0; i < distanceMap.length; i++) {
      const distance = distanceMap[i];
      if (distance <= radius) {
        const pixelIndex = i * 4;
        const weight = 1 - distance / radius;
        const newAlpha = Math.min(255, Math.round(255 * weight));

        data[pixelIndex + 3] = newAlpha;
        data[pixelIndex] = 255; // R
        data[pixelIndex + 1] = 255; // G
        data[pixelIndex + 2] = 255; // B
      }
    }
  }

  /**
   * 快速腐蚀算法 - 使用距离变换和阈值处理
   * @param data 像素数据
   * @param width 画布宽度
   * @param height 画布高度
   * @param radius 腐蚀半径
   */
  private fastErodeMask(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number,
  ): void {
    // 创建距离变换数组
    const distanceMap = new Float32Array(width * height);

    // 第一步：计算每个有颜色像素到最近透明像素的距离
    this.computeDistanceTransform(data, distanceMap, width, height, false);

    // 第二步：根据距离设置透明度
    for (let i = 0; i < distanceMap.length; i++) {
      const distance = distanceMap[i];
      if (distance <= radius) {
        const pixelIndex = i * 4;
        const currentAlpha = data[pixelIndex + 3];
        if (currentAlpha > 0) {
          const weight = distance / radius;
          const newAlpha = Math.max(0, Math.round(currentAlpha * weight));

          data[pixelIndex + 3] = newAlpha;

          if (newAlpha === 0) {
            data[pixelIndex] = 0; // R
            data[pixelIndex + 1] = 0; // G
            data[pixelIndex + 2] = 0; // B
          }
        }
      }
    }
  }

  /**
   * 计算距离变换 - 使用优化的两遍扫描算法
   * @param data 像素数据
   * @param distanceMap 距离映射数组
   * @param width 画布宽度
   * @param height 画布高度
   * @param isDilation 是否为膨胀操作
   */
  private computeDistanceTransform(
    data: Uint8ClampedArray,
    distanceMap: Float32Array,
    width: number,
    height: number,
    isDilation: boolean,
  ): void {
    const INF = width * height; // 无穷大值

    // 初始化距离映射
    for (let i = 0; i < distanceMap.length; i++) {
      const pixelIndex = i * 4;
      const alpha = data[pixelIndex + 3];

      if (isDilation) {
        // 膨胀：有颜色的像素距离为0，透明像素距离为无穷大
        distanceMap[i] = alpha > 0 ? 0 : INF;
      } else {
        // 腐蚀：透明像素距离为0，有颜色的像素距离为无穷大
        distanceMap[i] = alpha === 0 ? 0 : INF;
      }
    }

    // 第一遍扫描：从左到右，从上到下
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const currentDistance = distanceMap[index];

        // 检查左邻居
        if (x > 0) {
          const leftDistance = distanceMap[index - 1] + 1;
          if (leftDistance < currentDistance) {
            distanceMap[index] = leftDistance;
          }
        }

        // 检查上邻居
        if (y > 0) {
          const topDistance = distanceMap[index - width] + 1;
          if (topDistance < currentDistance) {
            distanceMap[index] = topDistance;
          }
        }
      }
    }

    // 第二遍扫描：从右到左，从下到上
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const index = y * width + x;
        const currentDistance = distanceMap[index];

        // 检查右邻居
        if (x < width - 1) {
          const rightDistance = distanceMap[index + 1] + 1;
          if (rightDistance < currentDistance) {
            distanceMap[index] = rightDistance;
          }
        }

        // 检查下邻居
        if (y < height - 1) {
          const bottomDistance = distanceMap[index + width] + 1;
          if (bottomDistance < currentDistance) {
            distanceMap[index] = bottomDistance;
          }
        }
      }
    }
  }

  /**
   * 获取当前偏移值
   */
  getOffset(): number {
    return this.offset;
  }
}
