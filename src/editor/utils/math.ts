// 数学工具函数
import type { Point, OBB, Size } from '../types';

export class MathUtils {
  // 角度转弧度
  static degToRad(degrees: number): number {
    return degrees * Math.PI / 180;
  }

  // 弧度转角度
  static radToDeg(radians: number): number {
    return radians * 180 / Math.PI;
  }

  // 点绕某点旋转
  static rotatePoint(point: Point, center: Point, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;

    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos
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
      { x: halfWidth, y: -halfHeight },  // 右上
      { x: halfWidth, y: halfHeight },   // 右下
      { x: -halfWidth, y: halfHeight }   // 左下
    ];

    // 旋转并转换为世界坐标
    const rotatedCorners = corners.map(corner => 
      this.rotatePoint({ x: center.x + corner.x, y: center.y + corner.y }, center, rotation)
    );

    return {
      center,
      size,
      rotation,
      corners: rotatedCorners
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
      max: { x: maxX, y: maxY }
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
      y: point.y * dpr
    };
  }

  // 将设备坐标转换为逻辑坐标
  static deviceToLogical(point: Point, dpr: number = MathUtils.getDevicePixelRatio()): Point {
    return {
      x: point.x / dpr,
      y: point.y / dpr
    };
  }

  // 验证Canvas是否正确设置了DPR
  static validateCanvasDPR(canvas: HTMLCanvasElement): boolean {
    const rect = canvas.getBoundingClientRect();
    const dpr = MathUtils.getDevicePixelRatio();
    
    const expectedWidth = rect.width * dpr;
    const expectedHeight = rect.height * dpr;
    
    return Math.abs(canvas.width - expectedWidth) < 1 && 
           Math.abs(canvas.height - expectedHeight) < 1;
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
      isCorrect: MathUtils.validateCanvasDPR(canvas)
    };
  }
}