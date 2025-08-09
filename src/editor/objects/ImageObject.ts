// 图像对象类
import { BaseObject } from './BaseObject';

export interface ImageObjectOptions {
  src?: string;
  crossOrigin?: string | null;
  filters?: string[];
}

export class ImageObject extends BaseObject {
  private image: HTMLImageElement;
  private imageLoaded: boolean = false;
  private src: string;
  public crossOrigin: string | null = null;
  public filters: string[] = [];
  
  // Mask 相关属性
  public maskCanvas?: HTMLCanvasElement;
  public maskCtx?: CanvasRenderingContext2D;
  public hasMask: boolean = false;
  public maskOpacity: number = 0.5;
  public maskColor: string = '#FF0000';

  constructor(src: string, options: Partial<ImageObject> & ImageObjectOptions = {}) {
    super('image', options);
    
    this.src = src;
    this.crossOrigin = options.crossOrigin || null;
    this.filters = options.filters || [];
    
    // 不设置默认尺寸，等待图片加载后使用原始尺寸
    this.width = 0;
    this.height = 0;
    
    this.image = new Image();
    this.setupImage();
  }

  private setupImage(): void {
    if (this.crossOrigin) {
      this.image.crossOrigin = this.crossOrigin;
    }

    this.image.onload = () => {
      this.imageLoaded = true;
      
      // 始终使用图像的原始尺寸，保持原始比例
      this.width = this.image.naturalWidth;
      this.height = this.image.naturalHeight;
      
      this.emit('image:loaded', { object: this, image: this.image });
    };

    this.image.onerror = (error) => {
      console.error('Failed to load image:', this.src, error);
      this.emit('image:error', { object: this, error, src: this.src });
    };

    // 检查图像是否已经加载完成（从缓存中）
    if (this.image.complete && this.image.naturalWidth > 0) {
      // 图像已经加载完成，直接触发事件
      console.log('图片已从缓存加载完成', this.image);
      this.imageLoaded = true;
      this.width = this.image.naturalWidth;
      this.height = this.image.naturalHeight;
      
      // 使用 setTimeout 确保事件监听器已经设置
      setTimeout(() => {
        this.emit('image:loaded', { object: this, image: this.image });
      }, 0);
    } else {
      // 图像未加载，设置源开始加载
      this.image.src = this.src;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || !this.imageLoaded) {
      return;
    }

    this.applyTransform(ctx);
    this.applyStyles(ctx);

    try {
      // 绘制图像，以中心点为基准
      const x = -this.width / 2;
      const y = -this.height / 2;

      // 应用滤镜
      if (this.filters.length > 0) {
        ctx.filter = this.filters.join(' ');
      }

      ctx.drawImage(this.image, x, y, this.width, this.height);

      // 重置滤镜
      if (this.filters.length > 0) {
        ctx.filter = 'none';
      }

      // 绘制边框（如果有）
      if (this.stroke && this.strokeWidth > 0) {
        ctx.strokeRect(x, y, this.width, this.height);
      }

      // 渲染mask叠加层
      this.renderMask(ctx, x, y);

      // 渲染颜色选区
      this.renderSelection(ctx, x, y);

    } catch (error) {
      console.error('Error rendering image:', error);
    }

    this.restoreTransform(ctx);
  }

  // 渲染mask叠加层
  private renderMask(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (!this.hasMask || !this.maskCanvas) {
      return;
    }

    ctx.save();
    
    // 设置透明度
    ctx.globalAlpha = this.maskOpacity;
    
    // 设置混合模式为源叠加
    ctx.globalCompositeOperation = 'source-over';
    
    // 创建临时画布来处理mask颜色
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCanvas.width = this.maskCanvas.width;
    tempCanvas.height = this.maskCanvas.height;
    
    // 绘制colored mask
    tempCtx.save();
    tempCtx.fillStyle = this.maskColor;
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(this.maskCanvas, 0, 0);
    tempCtx.restore();
    
    // 绘制colored mask到主画布
    ctx.drawImage(tempCanvas, x, y, this.width, this.height);
    
    ctx.restore();
  }

  // 渲染颜色选区叠加层
  private renderSelection(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const selectionCanvas = (this as any).selectionCanvas as HTMLCanvasElement;
    const hasSelection = (this as any).hasSelection as boolean;
    
    if (!hasSelection || !selectionCanvas) {
      return;
    }

    ctx.save();
    
    // 直接绘制选区蒙版（已包含透明度和颜色）
    ctx.drawImage(selectionCanvas, x, y, this.width, this.height);
    
    ctx.restore();
  }

  // 设置mask属性
  public setMaskOpacity(opacity: number): void {
    this.maskOpacity = Math.max(0, Math.min(1, opacity));
    this.emit('mask:opacity-changed', { object: this, opacity: this.maskOpacity });
  }

  public setMaskColor(color: string): void {
    this.maskColor = color;
    this.emit('mask:color-changed', { object: this, color: this.maskColor });
  }

  // 获取mask数据
  public getMaskData(): ImageData | null {
    if (!this.maskCanvas || !this.maskCtx) {
      return null;
    }
    
    try {
      return this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    } catch (error) {
      console.error('Error getting mask data:', error);
      return null;
    }
  }

  // 设置mask数据
  public setMaskData(imageData: ImageData): void {
    if (!this.maskCanvas || !this.maskCtx) {
      // 创建mask画布
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d')!;
    }
    
    this.maskCanvas.width = imageData.width;
    this.maskCanvas.height = imageData.height;
    
    try {
      this.maskCtx.putImageData(imageData, 0, 0);
      this.hasMask = true;
      this.emit('mask:data-changed', { object: this, imageData });
    } catch (error) {
      console.error('Error setting mask data:', error);
    }
  }

  // 清除mask
  public clearMask(): void {
    if (this.maskCanvas && this.maskCtx) {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.hasMask = false;
      this.emit('mask:cleared', { object: this });
    }
  }

  // 检查是否有mask
  public hasMaskData(): boolean {
    return this.hasMask && !!this.maskCanvas;
  }

  // 设置图像源
  setSrc(src: string): void {
    if (src === this.src) {
      return;
    }

    this.src = src;
    this.imageLoaded = false;
    
    // 重置图像状态
    this.image.onload = null;
    this.image.onerror = null;
    
    this.setupImage();
  }

  // 获取图像源
  getSrc(): string {
    return this.src;
  }

  // 检查图像是否已加载
  isLoaded(): boolean {
    return this.imageLoaded;
  }

  // 获取原始图像
  getImage(): HTMLImageElement {
    return this.image;
  }

  // 添加滤镜
  addFilter(filter: string): void {
    if (!this.filters.includes(filter)) {
      this.filters.push(filter);
      this.emit('image:filter-added', { object: this, filter });
    }
  }

  // 移除滤镜
  removeFilter(filter: string): void {
    const index = this.filters.indexOf(filter);
    if (index !== -1) {
      this.filters.splice(index, 1);
      this.emit('image:filter-removed', { object: this, filter });
    }
  }

  // 清除所有滤镜
  clearFilters(): void {
    this.filters = [];
    this.emit('image:filters-cleared', { object: this });
  }

  // 设置滤镜
  setFilters(filters: string[]): void {
    this.filters = [...filters];
    this.emit('image:filters-changed', { object: this, filters: this.filters });
  }

  // 获取图像数据
  getImageData(_ctx?: CanvasRenderingContext2D): ImageData | null {
    if (!this.imageLoaded) {
      return null;
    }

    try {
      // 创建临时canvas来获取图像数据
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      
      tempCtx.drawImage(this.image, 0, 0, this.width, this.height);
      return tempCtx.getImageData(0, 0, this.width, this.height);
    } catch (error) {
      console.error('Error getting image data:', error);
      return null;
    }
  }

  // 设置图像数据
  setImageData(imageData: ImageData): void {
    try {
      // 创建临时canvas来设置图像数据
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      
      tempCanvas.width = imageData.width;
      tempCanvas.height = imageData.height;
      
      tempCtx.putImageData(imageData, 0, 0);
      
      // 更新图像源
      this.setSrc(tempCanvas.toDataURL());
      
      // 更新尺寸
      this.width = imageData.width;
      this.height = imageData.height;
      
      this.emit('image:data-changed', { object: this, imageData });
    } catch (error) {
      console.error('Error setting image data:', error);
    }
  }

  // 裁剪图像
  crop(x: number, y: number, width: number, height: number): void {
    if (!this.imageLoaded) {
      return;
    }

    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      
      tempCanvas.width = width;
      tempCanvas.height = height;
      
      // 绘制裁剪后的图像
      tempCtx.drawImage(
        this.image,
        x, y, width, height,  // 源区域
        0, 0, width, height   // 目标区域
      );
      
      // 更新图像源和尺寸
      this.setSrc(tempCanvas.toDataURL());
      this.width = width;
      this.height = height;
      
      this.emit('image:cropped', { object: this, cropRect: { x, y, width, height } });
    } catch (error) {
      console.error('Error cropping image:', error);
    }
  }

  // 克隆图像对象
  clone(): ImageObject {
    const cloned = new ImageObject(this.src, {
      crossOrigin: this.crossOrigin,
      filters: [...this.filters],
      ...this.toJSON()
    });
    
    return cloned;
  }

  // 转换为JSON
  toJSON(): any {
    return {
      ...super.toJSON(),
      src: this.src,
      crossOrigin: this.crossOrigin,
      filters: [...this.filters],
      hasMask: this.hasMask,
      maskOpacity: this.maskOpacity,
      maskColor: this.maskColor,
      maskData: this.hasMask ? this.getMaskData() : null
    };
  }

  // 从JSON创建图像对象
  static fromJSON(data: any): ImageObject {
    const imageObj = new ImageObject(data.src, {
      ...data,
      crossOrigin: data.crossOrigin,
      filters: data.filters || []
    });
    
    // 恢复mask数据
    if (data.hasMask && data.maskData) {
      imageObj.setMaskData(data.maskData);
      imageObj.setMaskOpacity(data.maskOpacity || 0.5);
      imageObj.setMaskColor(data.maskColor || '#FF0000');
    }
    
    return imageObj;
  }

  // 销毁
  destroy(): void {
    this.image.onload = null;
    this.image.onerror = null;
    this.image.src = '';
    this.removeAllListeners();
  }
}