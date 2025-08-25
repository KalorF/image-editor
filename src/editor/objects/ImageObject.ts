// 图像对象类
import { EditorEvents, EditorRenderType } from '../types';
import { BaseObject } from './BaseObject';

export interface ImageObjectOptions {
  src?: string;
  crossOrigin?: string | null;
  filters?: string[];
}

// 简化的图像缓存管理器 - 无大小和时间限制
class ImageCacheManager {
  private static instance: ImageCacheManager;
  private cache = new Map<
    string,
    {
      image: HTMLImageElement;
      imageData?: ImageData;
      accessCount: number;
    }
  >();

  // URL 到索引的映射
  private urlToIndex = new Map<string, number>();
  private indexToUrl = new Map<number, string>();
  private nextIndex = 1;

  // 新增：maskData 缓存，使用对象ID作为键
  private maskDataCache = new Map<string, ImageData>();
  private nextMaskId = 1;

  static getInstance(): ImageCacheManager {
    if (!ImageCacheManager.instance) {
      ImageCacheManager.instance = new ImageCacheManager();
    }
    return ImageCacheManager.instance;
  }

  // 生成缓存键
  private generateKey(src: string, crossOrigin?: string | null): string {
    return `${src}_${crossOrigin || 'null'}`;
  }

  // 获取或创建 URL 索引
  getUrlIndex(src: string): number {
    if (this.urlToIndex.has(src)) {
      return this.urlToIndex.get(src)!;
    }

    const index = this.nextIndex++;
    this.urlToIndex.set(src, index);
    this.indexToUrl.set(index, src);
    return index;
  }

  // 根据索引获取 URL
  getUrlByIndex(index: number): string | undefined {
    return this.indexToUrl.get(index);
  }

  // 缓存 maskData 并返回ID
  cacheMaskData(maskData: ImageData): number {
    const maskId = this.nextMaskId++;
    this.maskDataCache.set(maskId.toString(), maskData);
    return maskId;
  }

  // 根据ID获取缓存的 maskData
  getMaskDataById(maskId: number): ImageData | null {
    return this.maskDataCache.get(maskId.toString()) || null;
  }

  // 获取或创建缓存
  get(src: string, crossOrigin?: string | null): HTMLImageElement | null {
    const key = this.generateKey(src, crossOrigin);
    const cached = this.cache.get(key);

    if (cached) {
      // 更新访问计数
      cached.accessCount++;
      return cached.image;
    }

    return null;
  }

  // 设置缓存
  set(src: string, crossOrigin: string | null, image: HTMLImageElement): void {
    const key = this.generateKey(src, crossOrigin);

    this.cache.set(key, {
      image,
      accessCount: 1,
    });
  }

  // 缓存 ImageData
  setImageData(src: string, crossOrigin: string | null, imageData: ImageData): void {
    const key = this.generateKey(src, crossOrigin);
    const cached = this.cache.get(key);
    if (cached) {
      cached.imageData = imageData;
    }
  }

  // 获取缓存的 ImageData
  getImageData(src: string, crossOrigin: string | null): ImageData | null {
    const key = this.generateKey(src, crossOrigin);
    const cached = this.cache.get(key);
    return cached?.imageData || null;
  }

  // 清除所有缓存（应用销毁时调用）
  clear(): void {
    this.cache.clear();
    this.urlToIndex.clear();
    this.indexToUrl.clear();
    this.nextIndex = 1;
    this.maskDataCache.clear();
    this.nextMaskId = 1;
  }

  // 获取缓存统计信息
  getStats(): { size: number; urlCount: number; maskDataCount: number } {
    return {
      size: this.cache.size,
      urlCount: this.urlToIndex.size,
      maskDataCount: this.maskDataCache.size,
    };
  }

  // 检查是否已缓存
  has(src: string, crossOrigin?: string | null): boolean {
    const key = this.generateKey(src, crossOrigin);
    return this.cache.has(key);
  }
}

export class ImageObject extends BaseObject {
  private image: HTMLImageElement;
  private imageLoaded: boolean = false;
  private src: string;
  public crossOrigin: string | null = null;
  public filters: string[] = [];
  // private cacheId: string; // 缓存标识符

  // Mask 相关属性
  public maskCanvas?: HTMLCanvasElement;
  public maskCtx?: CanvasRenderingContext2D;
  public hasMask: boolean = false;
  public maskOpacity: number = 0.5;
  public maskColor: string = '#FF0000';

  public hasApplyMask: boolean = false;
  public applyMaskCanvas?: HTMLCanvasElement;
  private hoverMaskCanvas?: HTMLCanvasElement | null = null;
  private tempApplyMaskCanvas?: HTMLCanvasElement | null = null;
  private tempHoverMaskCanvas?: HTMLCanvasElement | null = null;
  private tempRenderMaskCanvas?: HTMLCanvasElement | null = null;

  constructor(src: string, options: Partial<ImageObject> & ImageObjectOptions = {}) {
    super('image', options);

    this.src = src;
    this.crossOrigin = options.crossOrigin || null;
    this.filters = options.filters || [];
    // this.cacheId = this.generateCacheId();

    // 不设置默认尺寸，等待图片加载后使用原始尺寸
    this.width = 0;
    this.height = 0;

    this.image = new Image();
    this.setupImage();
  }

  // 生成唯一的缓存标识符
  // private generateCacheId(): string {
  //   return `${this.src}_${this.crossOrigin || 'null'}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  // }

  private setupImage(): void {
    if (this.crossOrigin) {
      this.image.crossOrigin = this.crossOrigin;
    }

    // 先尝试从缓存获取
    const cachedImage = ImageCacheManager.getInstance().get(this.src, this.crossOrigin);
    if (cachedImage) {
      this.image = cachedImage;
      this.imageLoaded = true;
      this.width = this.image.naturalWidth;
      this.height = this.image.naturalHeight;

      // 恢复缓存的 mask 数据
      this.restoreCachedData();

      setTimeout(() => {
        this.emit(EditorEvents.IMAGE_LOADED, { object: this, image: this.image });
      }, 0);
      return;
    }

    this.image.onload = () => {
      this.imageLoaded = true;

      // 始终使用图像的原始尺寸，保持原始比例
      this.width = this.image.naturalWidth;
      this.height = this.image.naturalHeight;

      // 添加到缓存
      ImageCacheManager.getInstance().set(this.src, this.crossOrigin, this.image);

      this.emit(EditorEvents.IMAGE_LOADED, { object: this, image: this.image });
    };

    this.image.onerror = error => {
      console.error('Failed to load image:', this.src, error);
      this.emit(EditorEvents.IMAGE_ERROR, { object: this, error, src: this.src });
    };

    // 检查图像是否已经加载完成（从缓存中）
    if (this.image.complete && this.image.naturalWidth > 0) {
      // 图像已经加载完成，直接触发事件
      console.log('图片已从缓存加载完成', this.image);
      this.imageLoaded = true;
      this.width = this.image.naturalWidth;
      this.height = this.image.naturalHeight;

      // 添加到缓存
      ImageCacheManager.getInstance().set(this.src, this.crossOrigin, this.image);

      // 使用 setTimeout 确保事件监听器已经设置
      setTimeout(() => {
        this.emit(EditorEvents.IMAGE_LOADED, { object: this, image: this.image });
      }, 0);
    } else {
      // 图像未加载，设置源开始加载
      this.image.src = this.src;
    }
  }

  // 恢复缓存的数据
  private restoreCachedData(): void {
    // const cacheManager = ImageCacheManager.getInstance();
    // // 恢复 mask 数据
    // const cachedMaskData = cacheManager.getMaskData(this.src, this.crossOrigin);
    // if (cachedMaskData && this.hasMask) {
    //   this.setMaskData(cachedMaskData);
    // }
  }

  render(ctx: CanvasRenderingContext2D, _type: EditorRenderType): void {
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

      if (this.hoverMaskCanvas) {
        this.drawHoverMask(ctx, this.image, x, y, this.width, this.height);
      } else if (this.hasApplyMask) {
        this.drawApplyMask(ctx, this.image, x, y, this.width, this.height);
      } else {
        ctx.drawImage(this.image, x, y, this.width, this.height);
      }

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

    if (!this.tempRenderMaskCanvas) {
      this.tempRenderMaskCanvas = document.createElement('canvas');
      this.tempRenderMaskCanvas.width = this.maskCanvas.width;
      this.tempRenderMaskCanvas.height = this.maskCanvas.height;
    }
    const tempCanvas = this.tempRenderMaskCanvas;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

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
    this.emit(EditorEvents.MASK_OPACITY_CHANGED, { object: this, opacity: this.maskOpacity });
  }

  public setMaskColor(color: string): void {
    this.maskColor = color;
    this.emit(EditorEvents.MASK_COLOR_CHANGED, { object: this, color: this.maskColor });
  }

  // 获取mask数据
  public getMaskData(): any | null {
    // if (!this.maskCanvas || !this.maskCtx) {
    //   return null;
    // }

    // try {
    //   const canvas = new OffscreenCanvas(this.width, this.height);
    //   const ctx = canvas.getContext('2d')!;
    //   ctx.drawImage(this.maskCanvas!, 0, 0);
    //   return canvas;
    // } catch (error) {
    //   console.error('Error getting mask data:', error);
    //   return null;
    // }

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
      this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
    }

    this.maskCanvas.width = imageData.width;
    this.maskCanvas.height = imageData.height;

    try {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.maskCtx.save();
      this.maskCtx.putImageData(imageData, 0, 0);
      this.maskCtx.restore();
      this.hasMask = true;
      this.emit(EditorEvents.MASK_DATA_CHANGED, { object: this, imageData });
    } catch (error) {
      console.error('Error setting mask data:', error);
    }
  }

  public applyMask(maskCanvas: HTMLCanvasElement | null): void {
    this.hasApplyMask = true;
    if (maskCanvas) {
      this.applyMaskCanvas = maskCanvas;
    }
  }

  public hoverMask(maskCanvas: HTMLCanvasElement | null): void {
    this.hoverMaskCanvas = maskCanvas;
  }

  public setMaskCanvas(maskCanvas: HTMLCanvasElement): void {
    this.maskCanvas = maskCanvas;
  }

  private drawApplyMask(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.tempApplyMaskCanvas) {
      this.tempApplyMaskCanvas = document.createElement('canvas');
      this.tempApplyMaskCanvas.width = image.width;
      this.tempApplyMaskCanvas.height = image.height;
    }
    const tempCanvas = this.tempApplyMaskCanvas;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.save();
    tempCtx.drawImage(image, 0, 0, image.width, image.height);
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(this.applyMaskCanvas as HTMLCanvasElement, 0, 0, image.width, image.height);
    tempCtx.restore();
    ctx.drawImage(tempCanvas, x, y, width, height);
  }

  private drawHoverMask(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.tempHoverMaskCanvas) {
      this.tempHoverMaskCanvas = document.createElement('canvas');
      this.tempHoverMaskCanvas.width = image.width;
      this.tempHoverMaskCanvas.height = image.height;
    }
    const tempCanvas = this.tempHoverMaskCanvas;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.save();
    tempCtx.drawImage(image, 0, 0, image.width, image.height);
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(this.hoverMaskCanvas as HTMLCanvasElement, 0, 0, image.width, image.height);
    tempCtx.restore();
    ctx.drawImage(tempCanvas, x, y, width, height);
  }

  // 清除mask
  public clearMask(): void {
    if (this.maskCanvas && this.maskCtx) {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.hasMask = false;
      this.emit(EditorEvents.MASK_CLEARED, { object: this });
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
      this.emit(EditorEvents.IMAGE_FILTER_ADDED, { object: this, filter });
    }
  }

  // 移除滤镜
  removeFilter(filter: string): void {
    const index = this.filters.indexOf(filter);
    if (index !== -1) {
      this.filters.splice(index, 1);
      this.emit(EditorEvents.IMAGE_FILTER_REMOVED, { object: this, filter });
    }
  }

  // 清除所有滤镜
  clearFilters(): void {
    this.filters = [];
    this.emit(EditorEvents.IMAGE_FILTERS_CLEARED, { object: this });
  }

  // 设置滤镜
  setFilters(filters: string[]): void {
    this.filters = [...filters];
    this.emit(EditorEvents.IMAGE_FILTERS_CHANGED, { object: this, filters: this.filters });
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

      this.emit(EditorEvents.IMAGE_DATA_CHANGED, { object: this, imageData });
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
        x,
        y,
        width,
        height, // 源区域
        0,
        0,
        width,
        height, // 目标区域
      );

      // 更新图像源和尺寸
      this.setSrc(tempCanvas.toDataURL());
      this.width = width;
      this.height = height;

      this.emit(EditorEvents.IMAGE_CROPPED, { object: this, cropRect: { x, y, width, height } });
    } catch (error) {
      console.error('Error cropping image:', error);
    }
  }

  // 克隆图像对象
  clone(): ImageObject {
    const cloned = new ImageObject(this.src, {
      crossOrigin: this.crossOrigin,
      filters: [...this.filters],
      ...this.toJSON(),
    });

    return cloned;
  }

  // 转换为JSON - 使用索引而不是完整数据
  toJSON(): any {
    const baseData = super.toJSON();
    const cacheManager = ImageCacheManager.getInstance();

    // 基础属性 - src 使用索引
    const jsonData: any = {
      ...baseData,
      srcIndex: cacheManager.getUrlIndex(this.src), // 使用 URL 索引
      crossOrigin: this.crossOrigin,
      filters: [...this.filters],
      hasMask: this.hasMask,
      maskOpacity: this.maskOpacity,
      maskColor: this.maskColor,
      // cacheId: this.cacheId, // 记录缓存ID而不是完整数据
    };

    // 如果有 mask 数据，每次都缓存并记录ID
    if (this.hasMask) {
      const maskData = this.getMaskData();
      if (maskData) {
        // 缓存 maskData 并获取ID
        const maskDataId = cacheManager.cacheMaskData(maskData);
        jsonData.maskDataId = maskDataId; // 记录 maskData 的ID
      }
    }

    return jsonData;
  }

  // 从JSON创建图像对象 - 使用缓存数据
  static fromJSON(data: any): ImageObject {
    const cacheManager = ImageCacheManager.getInstance();

    // 从索引恢复 src
    const src = cacheManager.getUrlByIndex(data.srcIndex);
    if (!src) {
      throw new Error(`Cannot find URL for index: ${data.srcIndex}`);
    }

    const imageObj = new ImageObject(src, {
      ...data,
      crossOrigin: data.crossOrigin,
      filters: data.filters || [],
    });

    // 恢复 mask 数据（从缓存获取）
    if (data.hasMask && data.maskDataId) {
      const cachedMaskData = cacheManager.getMaskDataById(data.maskDataId);

      if (cachedMaskData) {
        imageObj.setMaskData(cachedMaskData);
        imageObj.setMaskOpacity(data.maskOpacity || 0.5);
        imageObj.setMaskColor(data.maskColor || '#FF0000');
      }
    }

    return imageObj;
  }

  // 获取缓存管理器实例（供外部使用）
  static getCacheManager(): ImageCacheManager {
    return ImageCacheManager.getInstance();
  }

  // 销毁时清理缓存引用
  destroy(): void {
    this.image.onload = null;
    this.image.onerror = null;
    this.image.src = '';
    this.removeAllListeners();

    // 注意：不删除缓存，因为其他对象可能还在使用
  }
}

// 在应用销毁时清理缓存的工具函数
export function clearImageCache(): void {
  ImageCacheManager.getInstance().clear();
}

// 获取缓存统计信息的工具函数
export function getImageCacheStats(): { size: number; urlCount: number; maskDataCount: number } {
  return ImageCacheManager.getInstance().getStats();
}
