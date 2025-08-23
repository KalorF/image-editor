// 数学工具函数
import { ImageObject } from '../objects/ImageObject';
import type { OBB, Point, Size } from '../types';

export class MathUtils {
  // 角度转弧度
  static degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  // 弧度转角度
  static radToDeg(radians: number): number {
    return (radians * 180) / Math.PI;
  }

  // 点绕某点旋转
  static rotatePoint(point: Point, center: Point, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;

    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  }

  // 计算两点距离
  static distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 计算点到直线的距离
  static pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
    const A = lineEnd.y - lineStart.y;
    const B = lineStart.x - lineEnd.x;
    const C = lineEnd.x * lineStart.y - lineStart.x * lineEnd.y;

    return Math.abs(A * point.x + B * point.y + C) / Math.sqrt(A * A + B * B);
  }

  // 创建OBB
  static createOBB(center: Point, size: Size, rotation: number): OBB {
    const halfWidth = size.width / 2;
    const halfHeight = size.height / 2;

    // 计算四个角点（相对于中心点）
    const corners = [
      { x: -halfWidth, y: -halfHeight }, // 左上
      { x: halfWidth, y: -halfHeight }, // 右上
      { x: halfWidth, y: halfHeight }, // 右下
      { x: -halfWidth, y: halfHeight }, // 左下
    ];

    // 旋转并转换为世界坐标
    const rotatedCorners = corners.map(corner =>
      this.rotatePoint({ x: center.x + corner.x, y: center.y + corner.y }, center, rotation),
    );

    return {
      center,
      size,
      rotation,
      corners: rotatedCorners,
    };
  }

  // 点是否在OBB内部
  static pointInOBB(point: Point, obb: OBB): boolean {
    // 将点转换到OBB的本地坐标系
    const localPoint = this.rotatePoint(point, obb.center, -obb.rotation);
    const localCenter = obb.center;

    const halfWidth = obb.size.width / 2;
    const halfHeight = obb.size.height / 2;

    return (
      localPoint.x >= localCenter.x - halfWidth &&
      localPoint.x <= localCenter.x + halfWidth &&
      localPoint.y >= localCenter.y - halfHeight &&
      localPoint.y <= localCenter.y + halfHeight
    );
  }

  // 矩阵变换相关
  static applyTransform(point: Point, transform: DOMMatrix): Point {
    const transformedPoint = transform.transformPoint(new DOMPoint(point.x, point.y));
    return { x: transformedPoint.x, y: transformedPoint.y };
  }

  // 限制数值范围
  static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // 线性插值
  static lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }

  // 计算边界框
  static getBoundingBox(points: Point[]): { min: Point; max: Point } {
    if (points.length === 0) {
      return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    for (let i = 1; i < points.length; i++) {
      minX = Math.min(minX, points[i].x);
      minY = Math.min(minY, points[i].y);
      maxX = Math.max(maxX, points[i].x);
      maxY = Math.max(maxY, points[i].y);
    }

    return {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY },
    };
  }

  // DPR 相关工具方法

  // 获取正确的鼠标坐标，考虑设备像素比例
  static getCanvasMousePoint(event: MouseEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    // 获取鼠标在画布上的CSS逻辑坐标系坐标
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 注意：由于Editor的render方法中调用了ctx.scale(dpr, dpr)
    // 但canvas的逻辑坐标系仍然是CSS像素，所以这里直接返回CSS坐标
    // 不需要乘以DPR，因为canvas context已经处理了DPR缩放
    return { x, y };
  }

  // 获取设备像素比例
  static getDevicePixelRatio(): number {
    return window.devicePixelRatio || 1;
  }

  // 将逻辑坐标转换为设备坐标
  static logicalToDevice(point: Point, dpr: number = MathUtils.getDevicePixelRatio()): Point {
    return {
      x: point.x * dpr,
      y: point.y * dpr,
    };
  }

  // 将设备坐标转换为逻辑坐标
  static deviceToLogical(point: Point, dpr: number = MathUtils.getDevicePixelRatio()): Point {
    return {
      x: point.x / dpr,
      y: point.y / dpr,
    };
  }

  // 验证Canvas是否正确设置了DPR
  static validateCanvasDPR(canvas: HTMLCanvasElement): boolean {
    const rect = canvas.getBoundingClientRect();
    const dpr = MathUtils.getDevicePixelRatio();

    const expectedWidth = rect.width * dpr;
    const expectedHeight = rect.height * dpr;

    return (
      Math.abs(canvas.width - expectedWidth) < 1 && Math.abs(canvas.height - expectedHeight) < 1
    );
  }

  // 获取Canvas的DPR设置状态
  static getCanvasDPRInfo(canvas: HTMLCanvasElement): {
    dpr: number;
    cssSize: { width: number; height: number };
    actualSize: { width: number; height: number };
    isCorrect: boolean;
  } {
    const rect = canvas.getBoundingClientRect();
    const dpr = MathUtils.getDevicePixelRatio();

    return {
      dpr,
      cssSize: { width: rect.width, height: rect.height },
      actualSize: { width: canvas.width, height: canvas.height },
      isCorrect: MathUtils.validateCanvasDPR(canvas),
    };
  }
}

export function createGradient({
  ctx,
  x,
  y,
  size = 20,
  hardness = 1,
  color = 'rgba(0, 0, 0, 255)',
}: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  size?: number;
  hardness?: number;
  color?: string;
}) {
  hardness = Math.min(1, Math.max(0, hardness));
  ctx.imageSmoothingEnabled = true;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
  gradient.addColorStop(0, color);
  gradient.addColorStop(hardness, color);
  gradient.addColorStop(1, color.replace(/[^,]+(?=\))/, '0'));
  return gradient;
}

export function convertMaskToTransparent(maskImageData: ImageData) {
  const data = maskImageData.data.slice();

  const data32 = new Uint32Array(data.buffer);
  const len32 = data32.length;

  // 将黑色区域变为透明
  for (let i = 0; i < len32; i++) {
    const pixel = data32[i];
    const r = pixel & 0xff;
    const g = (pixel >> 8) & 0xff;
    const b = (pixel >> 16) & 0xff;

    // 快速亮度计算
    const brightness = (r + g + b) / 3;

    // 重新组装像素，保持RGB不变，更新Alpha
    data32[i] = (brightness << 24) | (pixel & 0x00ffffff);
  }
  return new ImageData(data, maskImageData.width, maskImageData.height);
}

export function worldToImageLocal(worldPoint: Point, imageObj: ImageObject): Point {
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

export function cloneCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = canvas.width;
  newCanvas.height = canvas.height;
  const ctx = newCanvas.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return newCanvas;
}

export function cloneOffscreenCanvas(canvas: HTMLCanvasElement): OffscreenCanvas {
  const newCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = newCanvas.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return newCanvas;
}

function isCanvasAllWhite(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // 使用 Uint32Array 进行批量处理，每个像素用 32 位表示
  const data32 = new Uint32Array(data.buffer);
  const len32 = data32.length;

  // 白色像素的 32 位表示：0xFFFFFFFF (RGBA: 255,255,255,255)
  const whitePixel = 0xffffffff;

  for (let i = 0; i < len32; i++) {
    if (data32[i] !== whitePixel) {
      return false;
    }
  }

  return true;
}

export function isCanvasAllWhiteOptimized(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const { width, height } = canvas;

  // 对于小尺寸图像，直接全量检测
  if (width * height <= 10000) {
    // 100x100 以下
    return isCanvasAllWhite(canvas);
  }

  // 大尺寸图像使用采样检测
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 1000)));

  // 检测边界像素
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 检测四边边界
  for (let x = 0; x < width; x += sampleStep) {
    // 上边界
    const topIndex = (x + 0 * width) * 4;
    if (
      data[topIndex] !== 255 ||
      data[topIndex + 1] !== 255 ||
      data[topIndex + 2] !== 255 ||
      data[topIndex + 3] !== 255
    ) {
      return false;
    }

    // 下边界
    const bottomIndex = (x + (height - 1) * width) * 4;
    if (
      data[bottomIndex] !== 255 ||
      data[bottomIndex + 1] !== 255 ||
      data[bottomIndex + 2] !== 255 ||
      data[bottomIndex + 3] !== 255
    ) {
      return false;
    }
  }

  for (let y = 0; y < height; y += sampleStep) {
    // 左边界
    const leftIndex = (0 + y * width) * 4;
    if (
      data[leftIndex] !== 255 ||
      data[leftIndex + 1] !== 255 ||
      data[leftIndex + 2] !== 255 ||
      data[leftIndex + 3] !== 255
    ) {
      return false;
    }

    // 右边界
    const rightIndex = (width - 1 + y * width) * 4;
    if (
      data[rightIndex] !== 255 ||
      data[rightIndex + 1] !== 255 ||
      data[rightIndex + 2] !== 255 ||
      data[rightIndex + 3] !== 255
    ) {
      return false;
    }
  }

  // 随机采样检测内部像素
  const sampleCount = Math.min(1000, Math.floor((width * height) / 100));
  for (let i = 0; i < sampleCount; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const index = (x + y * width) * 4;

    if (
      data[index] !== 255 ||
      data[index + 1] !== 255 ||
      data[index + 2] !== 255 ||
      data[index + 3] !== 255
    ) {
      return false;
    }
  }

  return true;
}
