// 渲染对象基类
import type { RenderObject, Transform, Point, OBB, Bounds } from '../types';
import { MathUtils } from '../utils/math';
import { EventEmitter } from '../core/EventEmitter';

export abstract class BaseObject extends EventEmitter implements RenderObject {
  public id: string;
  public type: string;
  public transform: Transform;
  public visible: boolean = true;
  public selectable: boolean = true;
  
  // 对象属性
  public width: number = 100;
  public height: number = 100;
  public fill: string = 'transparent';
  public stroke: string = '#000000';
  public strokeWidth: number = 1;
  public opacity: number = 1;

  constructor(type: string, options: Partial<BaseObject> = {}) {
    super();
    
    this.id = this.generateId();
    this.type = type;
    this.transform = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0
    };

    // 应用选项
    Object.assign(this, options);
  }

  // 生成唯一ID
  private generateId(): string {
    return `${this.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 抽象方法 - 子类必须实现
  abstract render(ctx: CanvasRenderingContext2D): void;

  abstract destroy(): void;

  // 获取对象的OBB
  getOBB(): OBB {
    return MathUtils.createOBB(
      { x: this.transform.x, y: this.transform.y },
      { width: this.width * this.transform.scaleX, height: this.height * this.transform.scaleY },
      this.transform.rotation
    );
  }

  // 点击测试
  hitTest(point: Point): boolean {
    if (!this.visible || !this.selectable) {
      return false;
    }

    const obb = this.getOBB();
    return MathUtils.pointInOBB(point, obb);
  }

  // 获取边界框
  getBounds(): Bounds {
    const obb = this.getOBB();
    const bbox = MathUtils.getBoundingBox(obb.corners);
    
    return {
      left: bbox.min.x,
      top: bbox.min.y,
      width: bbox.max.x - bbox.min.x,
      height: bbox.max.y - bbox.min.y
    };
  }

  // 移动对象
  move(deltaX: number, deltaY: number): void {
    this.transform.x += deltaX;
    this.transform.y += deltaY;
    this.emit('object:moved', { object: this, deltaX, deltaY });
  }

  // 设置位置
  setPosition(x: number, y: number): void {
    const oldX = this.transform.x;
    const oldY = this.transform.y;
    
    this.transform.x = x;
    this.transform.y = y;
    
    this.emit('object:moved', { 
      object: this, 
      deltaX: x - oldX, 
      deltaY: y - oldY 
    });
  }

  // 缩放对象
  scale(scaleX: number, scaleY: number = scaleX): void {
    this.transform.scaleX *= scaleX;
    this.transform.scaleY *= scaleY;
    this.emit('object:scaled', { object: this, scaleX, scaleY });
  }

  // 设置缩放
  setScale(scaleX: number, scaleY: number = scaleX): void {
    const oldScaleX = this.transform.scaleX;
    const oldScaleY = this.transform.scaleY;
    
    this.transform.scaleX = scaleX;
    this.transform.scaleY = scaleY;
    
    this.emit('object:scaled', { 
      object: this, 
      scaleX: scaleX / oldScaleX, 
      scaleY: scaleY / oldScaleY 
    });
  }

  // 旋转对象
  rotate(angle: number): void {
    this.transform.rotation += angle;
    this.emit('object:rotated', { object: this, angle });
  }

  // 设置旋转角度
  setRotation(angle: number): void {
    const oldRotation = this.transform.rotation;
    this.transform.rotation = angle;
    this.emit('object:rotated', { 
      object: this, 
      angle: angle - oldRotation 
    });
  }

  // 设置尺寸
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.emit('object:resized', { object: this, width, height });
  }

  // 克隆对象
  clone(): BaseObject {
    const cloned = Object.create(Object.getPrototypeOf(this));
    Object.assign(cloned, this);
    
    // 深拷贝transform
    cloned.transform = { ...this.transform };
    cloned.id = this.generateId();
    
    return cloned;
  }

  // 应用变换到画布上下文
  protected applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    
    // 移动到对象中心
    ctx.translate(this.transform.x, this.transform.y);
    
    // 旋转
    if (this.transform.rotation !== 0) {
      ctx.rotate(this.transform.rotation);
    }
    
    // 缩放
    if (this.transform.scaleX !== 1 || this.transform.scaleY !== 1) {
      ctx.scale(this.transform.scaleX, this.transform.scaleY);
    }
  }

  // 恢复变换
  protected restoreTransform(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  // 设置样式
  protected applyStyles(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = this.opacity;
    
    if (this.fill && this.fill !== 'transparent') {
      ctx.fillStyle = this.fill;
    }
    
    if (this.stroke && this.strokeWidth > 0) {
      ctx.strokeStyle = this.stroke;
      ctx.lineWidth = this.strokeWidth;
    }
  }

  // 检查是否与另一个对象相交
  intersectsWith(other: BaseObject): boolean {
    const thisBounds = this.getBounds();
    const otherBounds = other.getBounds();
    
    return !(
      thisBounds.left > otherBounds.left + otherBounds.width ||
      thisBounds.left + thisBounds.width < otherBounds.left ||
      thisBounds.top > otherBounds.top + otherBounds.height ||
      thisBounds.top + thisBounds.height < otherBounds.top
    );
  }

  // 获取中心点
  getCenter(): Point {
    return {
      x: this.transform.x,
      y: this.transform.y
    };
  }

  // 设置中心点
  setCenter(point: Point): void {
    this.setPosition(point.x, point.y);
  }

  // 转换为JSON
  toJSON(): any {
    return {
      id: this.id,
      type: this.type,
      transform: { ...this.transform },
      width: this.width,
      height: this.height,
      fill: this.fill,
      stroke: this.stroke,
      strokeWidth: this.strokeWidth,
      opacity: this.opacity,
      visible: this.visible,
      selectable: this.selectable
    };
  }

  // 从JSON创建对象
  static fromJSON(data: any): BaseObject {
    // 这个方法需要在子类中实现具体的创建逻辑
    throw new Error('fromJSON method must be implemented in subclass');
  }
}