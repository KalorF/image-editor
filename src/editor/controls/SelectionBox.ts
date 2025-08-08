// 基于OBB的选择框控制器
import type { Point, ControlPoint, OBB } from '../types';
import { ControlPointType } from '../types';
import { BaseObject } from '../objects/BaseObject';
import { MathUtils } from '../utils/math';
import { EventEmitter } from '../core/EventEmitter';
import { Viewport } from '../core/Viewport';

export interface SelectionBoxOptions {
  strokeColor?: string;
  strokeWidth?: number;
  controlPointSize?: number;
  controlPointColor?: string;
  controlPointStroke?: string;
  rotationHandleDistance?: number;
  rotationHandleSize?: number;
  viewport?: Viewport;
  canvas?: HTMLCanvasElement;
}

export class SelectionBox extends EventEmitter {
  private target: BaseObject | null = null;
  private controlPoints: ControlPoint[] = [];
  private viewport: Viewport | null = null;
  private canvas: HTMLCanvasElement | null = null;
  
  // 样式配置
  private strokeColor: string = '#2661f1';
  private strokeWidth: number = 1;
  private controlPointSize: number = 8;
  private controlPointColor: string = '#FFFFFF';
  private controlPointStroke: string = '#2661f1';
  private rotationHandleDistance: number = 30;
  private rotationHandleSize: number = 8;
  
  // 交互状态
  private isDragging: boolean = false;
  private dragType: 'move' | 'resize' | 'rotate' | null = null;
  private dragStartPoint: Point = { x: 0, y: 0 };
  private dragControlPoint: ControlPointType | null = null;
  private initialTransform: any = null;
  private initialOBB: OBB | null = null;

  constructor(options: SelectionBoxOptions = {}) {
    super();
    this.viewport = options.viewport || null;
    this.canvas = options.canvas || null;
    Object.assign(this, options);
  }

  // 设置选中的对象
  setTarget(target: BaseObject | null): void {
    const oldTarget = this.target;
    this.target = target;
    
    if (target) {
      this.updateControlPoints();
    } else {
      this.controlPoints = [];
    }
    
    this.emit('selection:changed', { oldTarget, newTarget: target });
  }

  // 获取当前选中的对象
  getTarget(): BaseObject | null {
    return this.target;
  }

  // 设置视口
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  // 设置画布
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  // 获取当前缩放调整后的控制点大小
  private getAdjustedControlPointSize(): number {
    if (!this.viewport) {
      return this.controlPointSize;
    }
    // 控制点大小除以缩放级别，使其在屏幕上保持固定大小
    // 注意：不需要除以DPR，因为canvas context已经在applyTransform中处理了DPR缩放
    return this.controlPointSize / this.viewport.zoom;
  }

  // 获取当前缩放调整后的旋转控制点大小
  private getAdjustedRotationHandleSize(): number {
    if (!this.viewport) {
      return this.rotationHandleSize;
    }
    // 旋转控制点大小除以缩放级别，使其在屏幕上保持固定大小
    // 注意：不需要除以DPR，因为canvas context已经在applyTransform中处理了DPR缩放
    return this.rotationHandleSize / this.viewport.zoom;
  }

  // 获取旋转控制点距离（始终使用初始化的固定值）
  private getAdjustedRotationHandleDistance(): number {
    // 始终返回初始化时设定的固定距离值，不受缩放影响
    return this.rotationHandleDistance;
  }

  // 计算旋转控制点位置（保持到MiddleTop的固定屏幕距离）
  private calculateRotationHandlePosition(obb: any): Point {
    const middleTopPoint = this.controlPoints.find(cp => cp.type === ControlPointType.MiddleTop);
    if (!middleTopPoint) {
      return { x: 0, y: 0 }; // 如果找不到MiddleTop控制点，则返回默认位置
    }
    
    if (!this.viewport) {
      // 如果没有viewport，使用简单的本地坐标计算
      const localOffset = {
        x: 0,
        y: -this.rotationHandleDistance
      };
      const rotatedOffset = MathUtils.rotatePoint(localOffset, { x: 0, y: 0 }, obb.rotation);
      return {
        x: middleTopPoint.position.x + rotatedOffset.x,
        y: middleTopPoint.position.y + rotatedOffset.y
      };
    }
    
    // 将MiddleTop点转换为屏幕坐标
    const middleTopScreenPoint = this.viewport.worldToScreen(middleTopPoint.position);
    
    // 计算对象在屏幕上的顶边方向
    const topLeftScreen = this.viewport.worldToScreen(obb.corners[0]);
    const topRightScreen = this.viewport.worldToScreen(obb.corners[1]);
    
    // 计算顶边的方向向量
    const topEdgeVector = {
      x: topRightScreen.x - topLeftScreen.x,
      y: topRightScreen.y - topLeftScreen.y
    };
    
    // 计算垂直于顶边向上的方向（逆时针旋转90度）
    const perpendicular = {
      x: -topEdgeVector.y,
      y: topEdgeVector.x
    };
    
    // 标准化垂直向量
    const perpLength = Math.sqrt(perpendicular.x * perpendicular.x + perpendicular.y * perpendicular.y);
    if (perpLength === 0) {
      return middleTopPoint.position; // 防止除零错误
    }
    
    const normalizedPerp = {
      x: perpendicular.x / perpLength,
      y: perpendicular.y / perpLength
    };
    
    // 在屏幕坐标系中，从MiddleTop点沿垂直方向向上偏移固定像素距离
    const rotationHandleScreenPoint = {
      x: middleTopScreenPoint.x + normalizedPerp.x * this.rotationHandleDistance,
      y: middleTopScreenPoint.y + normalizedPerp.y * this.rotationHandleDistance
    };
    
    // 将屏幕坐标转换回世界坐标
    return this.viewport.screenToWorld(rotationHandleScreenPoint);
  }

  // 获取当前缩放调整后的线宽
  private getAdjustedLineWidth(baseLineWidth: number = 1): number {
    if (!this.viewport) {
      return baseLineWidth;
    }
    // 线宽除以缩放级别，使其在屏幕上保持固定宽度
    // 注意：不需要除以DPR，因为canvas context已经在applyTransform中处理了DPR缩放
    return baseLineWidth / this.viewport.zoom;
  }

  // 更新控制点
  private updateControlPoints(): void {
    if (!this.target) {
      this.controlPoints = [];
      return;
    }

    const obb = this.target.getOBB();
    const corners = obb.corners;
    
    this.controlPoints = [
      // 四个角点
      {
        type: ControlPointType.TopLeft,
        position: corners[0],
        cursor: this.getResizeCursor(obb.rotation, 'nw')
      },
      {
        type: ControlPointType.TopRight,
        position: corners[1],
        cursor: this.getResizeCursor(obb.rotation, 'ne')
      },
      {
        type: ControlPointType.BottomRight,
        position: corners[2],
        cursor: this.getResizeCursor(obb.rotation, 'se')
      },
      {
        type: ControlPointType.BottomLeft,
        position: corners[3],
        cursor: this.getResizeCursor(obb.rotation, 'sw')
      },
      
      // 中点控制点
      {
        type: ControlPointType.MiddleTop,
        position: this.getMidPoint(corners[0], corners[1]),
        cursor: this.getResizeCursor(obb.rotation, 'n')
      },
      {
        type: ControlPointType.MiddleRight,
        position: this.getMidPoint(corners[1], corners[2]),
        cursor: this.getResizeCursor(obb.rotation, 'e')
      },
      {
        type: ControlPointType.MiddleBottom,
        position: this.getMidPoint(corners[2], corners[3]),
        cursor: this.getResizeCursor(obb.rotation, 's')
      },
      {
        type: ControlPointType.MiddleLeft,
        position: this.getMidPoint(corners[3], corners[0]),
        cursor: this.getResizeCursor(obb.rotation, 'w')
      }
    ];

    // 添加旋转控制点
    // 基于MiddleTop控制点位置，向上偏移固定距离
    const middleTopPoint = this.controlPoints.find(cp => cp.type === ControlPointType.MiddleTop);
    if (!middleTopPoint) {
      return; // 如果找不到MiddleTop控制点，则不添加旋转控制点
    }
    
    // 在本地坐标系中计算偏移：从MiddleTop点向上（负Y方向）偏移固定距离
    const localOffset = {
      x: 0, // 水平方向不偏移
      y: -this.rotationHandleDistance // 向上偏移固定距离
    };
    
    // 将偏移量应用旋转变换
    const rotatedOffset = MathUtils.rotatePoint(
      localOffset,
      { x: 0, y: 0 }, // 绕原点旋转
      obb.rotation
    );
    
    // 计算旋转控制点的最终位置
    const rotatedPoint = {
      x: middleTopPoint.position.x + rotatedOffset.x,
      y: middleTopPoint.position.y + rotatedOffset.y
    };
    
    this.controlPoints.push({
      type: ControlPointType.Rotation,
      position: rotatedPoint,
      cursor: 'crosshair'
    });
  }

  // 获取中点
  private getMidPoint(p1: Point, p2: Point): Point {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    };
  }

  // 将点投影到通过对象中心的水平或垂直线上（考虑旋转）
  private projectPointToLine(point: Point, center: Point, rotation: number, direction: 'horizontal' | 'vertical'): Point {
    // 将点转换到本地坐标系
    const localPoint = MathUtils.rotatePoint(point, center, -rotation);
    const localCenter = center;
    
    if (direction === 'horizontal') {
      // 投影到水平线（Y坐标固定）
      const projectedLocal = { x: localPoint.x, y: localCenter.y };
      return MathUtils.rotatePoint(projectedLocal, center, rotation);
    } else {
      // 投影到垂直线（X坐标固定）
      const projectedLocal = { x: localCenter.x, y: localPoint.y };
      return MathUtils.rotatePoint(projectedLocal, center, rotation);
    }
  }

  // 获取调整大小的光标
  private getResizeCursor(rotation: number, direction: string): string {
    const angle = MathUtils.radToDeg(rotation);
    const normalizedAngle = ((angle % 360) + 360) % 360;
    
    // 根据旋转角度调整光标方向
    // 基础光标样式（按顺序：西北、北、东北、东、东南、南、西南、西）
    const baseCursors = ['nw-resize', 'n-resize', 'ne-resize', 'e-resize', 'se-resize', 's-resize', 'sw-resize', 'w-resize'];
    
    // 控制点类型对应的起始索引
    const cursorStartIndex: Record<string, number> = {
      'nw': 0, 'n': 1, 'ne': 2, 'e': 3,
      'se': 4, 's': 5, 'sw': 6, 'w': 7
    };
    
    // 生成旋转光标数组的函数
    const generateRotatedCursors = (startIndex: number): string[] => {
      const result: string[] = [];
      for (let i = 0; i < 8; i++) {
        result.push(baseCursors[(startIndex + i) % 8]);
      }
      return result;
    };
    
    // 生成光标映射
    const cursors: Record<string, string[]> = {};
    Object.keys(cursorStartIndex).forEach(key => {
      cursors[key] = generateRotatedCursors(cursorStartIndex[key]);
    });
    
    const directionCursors = cursors[direction] || ['default'];
    const index = Math.round(normalizedAngle / 45) % 8;
    return directionCursors[index] || 'default';
  }

  // 处理鼠标按下
  handleMouseDown(point: Point, _event: MouseEvent): boolean {
    if (!this.target) {
      return false;
    }

    // 检查是否点击了控制点
    const controlPoint = this.getControlPointAt(point);
    if (controlPoint) {
      this.startDrag(point, controlPoint.type);
      return true;
    }

    // 检查是否点击了对象本身
    if (this.target.hitTest(point)) {
      this.startDrag(point, 'move');
      return true;
    }

    return false;
  }

  // 开始拖拽
  private startDrag(point: Point, type: 'move' | ControlPointType): void {
    if (!this.target) return;

    this.isDragging = true;
    this.dragStartPoint = { ...point };
    this.initialTransform = { ...this.target.transform };
    this.initialOBB = this.target.getOBB();

    if (type === 'move') {
      this.dragType = 'move';
    } else if (type === ControlPointType.Rotation) {
      this.dragType = 'rotate';
    } else {
      this.dragType = 'resize';
      this.dragControlPoint = type;
    }

    this.emit('drag:start', { 
      target: this.target, 
      type: this.dragType, 
      point: point 
    });
  }

  // 处理鼠标移动
  handleMouseMove(point: Point): boolean {
    if (!this.target) {
      return false;
    }

    if (!this.isDragging) {
      // 更新光标
      const controlPoint = this.getControlPointAt(point);
      if (controlPoint) {
        if (this.canvas) {
          this.canvas.style.cursor = controlPoint.cursor;
        }
        return true;
      } else if (this.target.hitTest(point)) {
        if (this.canvas) {
          this.canvas.style.cursor = 'move';
        }
        return true;
      } else {
        if (this.canvas) {
          this.canvas.style.cursor = 'default';
        }
        return false;
      }
    }

    // 处理拖拽
    const deltaX = point.x - this.dragStartPoint.x;
    const deltaY = point.y - this.dragStartPoint.y;

    switch (this.dragType) {
      case 'move':
        this.handleMove(deltaX, deltaY);
        break;
      case 'resize':
        this.handleResize(point);
        break;
      case 'rotate':
        this.handleRotate(point);
        break;
    }

    this.updateControlPoints();
    this.emit('drag:move', { 
      target: this.target, 
      type: this.dragType, 
      point: point 
    });

    return true;
  }

  // 处理移动
  private handleMove(deltaX: number, deltaY: number): void {
    if (!this.target || !this.initialTransform) return;

    this.target.setPosition(
      this.initialTransform.x + deltaX,
      this.initialTransform.y + deltaY
    );
  }

  // 处理缩放 - 以对角点为固定点，控制点跟手缩放
  private handleResize(currentPoint: Point): void {
    if (!this.target || !this.initialOBB || !this.dragControlPoint || !this.initialTransform) return;

    const center = this.initialOBB.center;
    const rotation = this.initialOBB.rotation;
    
    // 将当前点转换到本地坐标系进行计算
    const localCurrentPoint = MathUtils.rotatePoint(currentPoint, center, -rotation);
    const localCenter = center;
    
    // 获取初始尺寸
    const initialWidth = this.initialOBB.size.width;
    const initialHeight = this.initialOBB.size.height;
    
    // 在本地坐标系中计算固定点和新尺寸
    let localFixedPoint: Point;
    let newLocalCenterX = localCenter.x;
    let newLocalCenterY = localCenter.y;
    let scaleX = 1;
    let scaleY = 1;
    
    switch (this.dragControlPoint) {
      case ControlPointType.TopLeft:
        // 以右下角为固定点
        localFixedPoint = { x: localCenter.x + initialWidth / 2, y: localCenter.y + initialHeight / 2 };
        
        // 角点缩放：使用对角线距离保持比例
        const initialDiagonal1 = Math.sqrt(initialWidth * initialWidth + initialHeight * initialHeight);
        const newDiagonal1 = MathUtils.distance(localFixedPoint, localCurrentPoint);
        const scale1 = Math.max(0.1, newDiagonal1 / initialDiagonal1);
        scaleX = scale1;
        scaleY = scale1;
        
        // 基于固定点和缩放比例计算新中心点
        const newHalfWidth1 = (initialWidth * scale1) / 2;
        const newHalfHeight1 = (initialHeight * scale1) / 2;
        newLocalCenterX = localFixedPoint.x - newHalfWidth1;
        newLocalCenterY = localFixedPoint.y - newHalfHeight1;
        break;
        
      case ControlPointType.TopRight:
        // 以左下角为固定点
        localFixedPoint = { x: localCenter.x - initialWidth / 2, y: localCenter.y + initialHeight / 2 };
        
        const initialDiagonal2 = Math.sqrt(initialWidth * initialWidth + initialHeight * initialHeight);
        const newDiagonal2 = MathUtils.distance(localFixedPoint, localCurrentPoint);
        const scale2 = Math.max(0.1, newDiagonal2 / initialDiagonal2);
        scaleX = scale2;
        scaleY = scale2;
        
        const newHalfWidth2 = (initialWidth * scale2) / 2;
        const newHalfHeight2 = (initialHeight * scale2) / 2;
        newLocalCenterX = localFixedPoint.x + newHalfWidth2;
        newLocalCenterY = localFixedPoint.y - newHalfHeight2;
        break;
        
      case ControlPointType.BottomRight:
        // 以左上角为固定点
        localFixedPoint = { x: localCenter.x - initialWidth / 2, y: localCenter.y - initialHeight / 2 };
        
        const initialDiagonal3 = Math.sqrt(initialWidth * initialWidth + initialHeight * initialHeight);
        const newDiagonal3 = MathUtils.distance(localFixedPoint, localCurrentPoint);
        const scale3 = Math.max(0.1, newDiagonal3 / initialDiagonal3);
        scaleX = scale3;
        scaleY = scale3;
        
        const newHalfWidth3 = (initialWidth * scale3) / 2;
        const newHalfHeight3 = (initialHeight * scale3) / 2;
        newLocalCenterX = localFixedPoint.x + newHalfWidth3;
        newLocalCenterY = localFixedPoint.y + newHalfHeight3;
        break;
        
      case ControlPointType.BottomLeft:
        // 以右上角为固定点
        localFixedPoint = { x: localCenter.x + initialWidth / 2, y: localCenter.y - initialHeight / 2 };
        
        const initialDiagonal4 = Math.sqrt(initialWidth * initialWidth + initialHeight * initialHeight);
        const newDiagonal4 = MathUtils.distance(localFixedPoint, localCurrentPoint);
        const scale4 = Math.max(0.1, newDiagonal4 / initialDiagonal4);
        scaleX = scale4;
        scaleY = scale4;
        
        const newHalfWidth4 = (initialWidth * scale4) / 2;
        const newHalfHeight4 = (initialHeight * scale4) / 2;
        newLocalCenterX = localFixedPoint.x - newHalfWidth4;
        newLocalCenterY = localFixedPoint.y + newHalfHeight4;
        break;
        
      case ControlPointType.MiddleTop:
        // 以下边为固定线，只调整高度
        localFixedPoint = { x: localCenter.x, y: localCenter.y + initialHeight / 2 };
        newLocalCenterY = (localFixedPoint.y + localCurrentPoint.y) / 2;
        
        const newHeight5 = Math.abs(localFixedPoint.y - localCurrentPoint.y);
        scaleY = Math.max(0.1, newHeight5 / initialHeight);
        break;
        
      case ControlPointType.MiddleBottom:
        // 以上边为固定线，只调整高度
        localFixedPoint = { x: localCenter.x, y: localCenter.y - initialHeight / 2 };
        newLocalCenterY = (localFixedPoint.y + localCurrentPoint.y) / 2;
        
        const newHeight6 = Math.abs(localFixedPoint.y - localCurrentPoint.y);
        scaleY = Math.max(0.1, newHeight6 / initialHeight);
        break;
        
      case ControlPointType.MiddleLeft:
        // 以右边为固定线，只调整宽度
        localFixedPoint = { x: localCenter.x + initialWidth / 2, y: localCenter.y };
        newLocalCenterX = (localFixedPoint.x + localCurrentPoint.x) / 2;
        
        const newWidth7 = Math.abs(localFixedPoint.x - localCurrentPoint.x);
        scaleX = Math.max(0.1, newWidth7 / initialWidth);
        break;
        
      case ControlPointType.MiddleRight:
        // 以左边为固定线，只调整宽度
        localFixedPoint = { x: localCenter.x - initialWidth / 2, y: localCenter.y };
        newLocalCenterX = (localFixedPoint.x + localCurrentPoint.x) / 2;
        
        const newWidth8 = Math.abs(localFixedPoint.x - localCurrentPoint.x);
        scaleX = Math.max(0.1, newWidth8 / initialWidth);
        break;
        
      default:
        return;
    }
    
    // 将新中心点转换回世界坐标系
    const newLocalCenter = { x: newLocalCenterX, y: newLocalCenterY };
    const newWorldCenter = MathUtils.rotatePoint(newLocalCenter, center, rotation);
    
    // 应用变换
    this.target.setPosition(newWorldCenter.x, newWorldCenter.y);
    this.target.setScale(
      this.initialTransform.scaleX * scaleX,
      this.initialTransform.scaleY * scaleY
    );
  }

  // 处理旋转
  private handleRotate(currentPoint: Point): void {
    if (!this.target || !this.initialOBB) return;

    const center = this.initialOBB.center;
    
    // 计算初始角度和当前角度
    const initialAngle = Math.atan2(
      this.dragStartPoint.y - center.y,
      this.dragStartPoint.x - center.x
    );
    
    const currentAngle = Math.atan2(
      currentPoint.y - center.y,
      currentPoint.x - center.x
    );
    
    const deltaAngle = currentAngle - initialAngle;
    const newRotation = this.initialTransform!.rotation + deltaAngle;
    
    this.target.setRotation(newRotation);
  }

  // 处理鼠标抬起
  handleMouseUp(): boolean {
    if (!this.isDragging) {
      return false;
    }

    this.isDragging = false;
    const dragType = this.dragType;
    this.dragType = null;
    this.dragControlPoint = null;
    this.initialTransform = null;
    this.initialOBB = null;

    if (this.canvas) {
      this.canvas.style.cursor = 'default';
    }

    this.emit('drag:end', { 
      target: this.target, 
      type: dragType 
    });

    return true;
  }

  // 获取指定位置的控制点
  private getControlPointAt(point: Point): ControlPoint | null {
    const adjustedControlPointSize = this.getAdjustedControlPointSize();
    const adjustedRotationHandleSize = this.getAdjustedRotationHandleSize();
    // 添加一点容差来提高控制点的可点击性
    const basePadding = 2;
    const threshold = Math.max(adjustedControlPointSize, adjustedRotationHandleSize) / 2 + basePadding;
    
    for (const controlPoint of this.controlPoints) {
      const distance = MathUtils.distance(point, controlPoint.position);
      if (distance <= threshold) {
        return controlPoint;
      }
    }
    
    return null;
  }

  // 渲染选择框
  render(ctx: CanvasRenderingContext2D): void {
    if (!this.target || this.controlPoints.length === 0) {
      return;
    }

    const obb = this.target.getOBB();
    
    ctx.save();
    
    // 绘制选择框边界
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.getAdjustedLineWidth(this.strokeWidth);
    const dashSize = this.getAdjustedLineWidth(5);
    ctx.setLineDash([dashSize, dashSize]);
    
    ctx.beginPath();
    const corners = obb.corners;
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    
    ctx.setLineDash([]);

    // 绘制控制点
    ctx.fillStyle = this.controlPointColor;
    ctx.strokeStyle = this.controlPointStroke;
    ctx.lineWidth = this.getAdjustedLineWidth(1);
    
    const adjustedControlPointSize = this.getAdjustedControlPointSize();
    const adjustedRotationHandleSize = this.getAdjustedRotationHandleSize();
    
    for (const controlPoint of this.controlPoints) {
      const size = controlPoint.type === ControlPointType.Rotation 
        ? adjustedRotationHandleSize 
        : adjustedControlPointSize;
        
      ctx.beginPath();
      
      if (controlPoint.type === ControlPointType.Rotation) {
        // 旋转控制点绘制为圆形
        ctx.arc(controlPoint.position.x, controlPoint.position.y, size / 2, 0, Math.PI * 2);
      } else {
        // 其他控制点绘制为与选择框边线平行的正方形
        ctx.save();
        // 将原点移到控制点位置并按对象旋转角度旋转
        ctx.translate(controlPoint.position.x, controlPoint.position.y);
        ctx.rotate(obb.rotation);
        ctx.rect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
      
      ctx.fill();
      ctx.stroke();
    }

    // 绘制旋转控制点的连接线
    const rotationPoint = this.controlPoints.find(cp => cp.type === ControlPointType.Rotation);
    const topMiddlePoint = this.controlPoints.find(cp => cp.type === ControlPointType.MiddleTop);
    if (rotationPoint && topMiddlePoint) {
      ctx.strokeStyle = this.strokeColor;
      ctx.lineWidth = this.getAdjustedLineWidth(1);
      ctx.beginPath();
      ctx.moveTo(topMiddlePoint.position.x, topMiddlePoint.position.y);
      ctx.lineTo(rotationPoint.position.x, rotationPoint.position.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 检查是否有选中的对象
  hasSelection(): boolean {
    return this.target !== null;
  }

  // 清除选择
  clearSelection(): void {
    this.setTarget(null);
  }

  // 销毁
  destroy(): void {
    this.target = null;
    this.controlPoints = [];
    this.removeAllListeners();
  }
}