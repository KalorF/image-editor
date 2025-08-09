// 颜色选区插件 - 通过圆形选区和洪水算法进行颜色选择
import type { Plugin, Point } from '../types';
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { MathUtils } from '../utils/math';

export interface ColorSelectionPluginOptions {
  enabled?: boolean;
  tolerance?: number; // 颜色容差值
  selectionColor?: string; // 选区显示颜色
  selectionOpacity?: number; // 选区透明度
  debug?: boolean; // 调试模式
}

export class ColorSelectionPlugin implements Plugin {
  name = 'colorSelection';
  version = '1.0.0';
  
  private editor!: Editor;
  private options: ColorSelectionPluginOptions;
  
  // 选区状态
  private isSelecting: boolean = false;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private currentImageObject: ImageObject | null = null;
  
  // 性能优化：限制重渲染频率
  private lastRenderTime: number = 0;
  private renderDelay: number = 16; // 约60fps
  
  // 选区结果
  private selectionMask: Uint8Array | null = null;
  private selectionCanvas: HTMLCanvasElement | null = null;
  private selectionCtx: CanvasRenderingContext2D | null = null;
  
  constructor(options: ColorSelectionPluginOptions = {}) {
    this.options = {
      enabled: true,
      tolerance: 32,
      selectionColor: '#00FF00',
      selectionOpacity: 0.3,
      debug: false,
      ...options
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    
    // 绑定鼠标事件
    this.bindEvents();
    
    // 注册渲染钩子，用于绘制实时圆形选区
    this.editor.hooks.after('render:after', (ctx: CanvasRenderingContext2D) => {
      this.drawCircleSelection(ctx);
    });
    
    // 添加插件方法到编辑器
    (editor as any).colorSelection = {
      enable: () => this.enable(),
      disable: () => this.disable(),
      setTolerance: (tolerance: number) => this.setTolerance(tolerance),
      setSelectionColor: (color: string) => this.setSelectionColor(color),
      setSelectionOpacity: (opacity: number) => this.setSelectionOpacity(opacity),
      clearSelection: () => this.clearSelection(),
      getSelectionMask: () => this.getSelectionMask(),
      isEnabled: () => this.options.enabled,
      getTolerance: () => this.options.tolerance,
      getSelectionColor: () => this.options.selectionColor,
      getSelectionOpacity: () => this.options.selectionOpacity
    };
  }

  uninstall(editor: Editor): void {
    this.unbindEvents();
    this.clearSelection();
    
    this.editor.hooks.removeHook('render:after', this.drawCircleSelection.bind(this));
    
    delete (editor as any).colorSelection;
  }

  private bindEvents(): void {
    const canvas = this.editor.getCanvas();
    
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  private unbindEvents(): void {
    const canvas = this.editor.getCanvas();
    
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
  }

  private onMouseDown = (event: MouseEvent) => {
    if (!this.options.enabled || this.editor.getTool() !== 'colorSelection') {
      return;
    }

    // 只处理左键点击
    if (event.button !== 0) {
      return;
    }

    const point = this.getMousePoint(event);
    const hitObject = this.editor.getObjectAt(point);
    
    if (hitObject && hitObject instanceof ImageObject) {
      this.isSelecting = true;
      this.startPoint = point;
      this.currentPoint = point;
      this.currentImageObject = hitObject;
      
      // 清除之前的选区
      this.clearSelection();
      
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.isSelecting || !this.startPoint || !this.currentImageObject) {
      return;
    }

    this.currentPoint = this.getMousePoint(event);
    
    // 只在鼠标移动时更新圆形预览，不执行耗性能的洪水算法
    // 洪水算法只在鼠标抬起时执行一次，确保流畅的交互体验
    
    // 限制重渲染频率，避免过于频繁的渲染导致卡顿
    const now = performance.now();
    if (now - this.lastRenderTime > this.renderDelay) {
      this.editor.requestRender();
      this.lastRenderTime = now;
    }
    
    event.preventDefault();
  };

  private onMouseUp = (_event: MouseEvent) => {
    if (this.isSelecting && this.startPoint && this.currentPoint && this.currentImageObject) {
      // 只在鼠标抬起时执行一次颜色选择，确保性能
      this.performColorSelection();
      
      // 触发选择完成事件
      this.editor.emit('colorSelection:completed', { 
        imageObject: this.currentImageObject,
        tolerance: this.options.tolerance 
      });
      
      this.isSelecting = false;
      this.startPoint = null;
      this.currentPoint = null;
      this.currentImageObject = null;
    }
  };

  private onMouseLeave = (_event: MouseEvent) => {
    if (this.isSelecting) {
      // 创建一个空的事件对象用于清理
      const fakeEvent = { button: 0 } as MouseEvent;
      this.onMouseUp(fakeEvent);
    }
  };

  private getMousePoint(event: MouseEvent): Point {
    // 使用与Editor完全相同的方法
    const canvas = this.editor.getCanvas();
    const canvasPoint = MathUtils.getCanvasMousePoint(event, canvas);
    
    // 添加调试信息
    if (this.options.debug) {
      console.log('Raw event:', event.clientX, event.clientY);
      console.log('Canvas rect:', canvas.getBoundingClientRect());
      console.log('Canvas point before world transform:', canvasPoint);
      const worldPoint = this.editor.viewport.screenToWorld(canvasPoint);
      console.log('World point after transform:', worldPoint);
    }
    
    // 转换为世界坐标
    return this.editor.viewport.screenToWorld(canvasPoint);
  }



  private drawCircleSelection(ctx: CanvasRenderingContext2D): void {
    // 只有在正在选择且工具激活时才绘制
    if (!this.isSelecting || !this.startPoint || !this.currentPoint || 
        !this.options.enabled || this.editor.getTool() !== 'colorSelection') {
      return;
    }
    
    // 重要：在render:after钩子中，context已经应用了viewport变换
    // 我们需要重置变换矩阵，使用原始的屏幕坐标系
    ctx.save();
    
    // 重置为单位矩阵，但保持DPR缩放
    const devicePixelRatio = window.devicePixelRatio || 1;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    
    // 将世界坐标转换到屏幕坐标
    const viewportStart = this.editor.viewport.worldToScreen(this.startPoint);
    const viewportCurrent = this.editor.viewport.worldToScreen(this.currentPoint);
    
    // 在屏幕坐标中计算半径，确保准确性
    const viewportRadius = Math.sqrt(
      Math.pow(viewportCurrent.x - viewportStart.x, 2) + 
      Math.pow(viewportCurrent.y - viewportStart.y, 2)
    );
    
    // 如果半径太小就不绘制
    if (viewportRadius < 5) {
      ctx.restore();
      return;
    }
    
    // 使用屏幕坐标绘制
    const viewportCenter = viewportStart;
    
    // 绘制圆形选区
    ctx.strokeStyle = this.options.selectionColor || '#00FF00';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(viewportCenter.x, viewportCenter.y, viewportRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // 恢复原来的变换矩阵
    ctx.restore();
  }

  private performColorSelection(): void {
    if (!this.startPoint || !this.currentPoint || !this.currentImageObject) return;
    
    // 计算圆形选区半径
    const radius = Math.sqrt(
      Math.pow(this.currentPoint.x - this.startPoint.x, 2) + 
      Math.pow(this.currentPoint.y - this.startPoint.y, 2)
    );
    
    // 获取图像数据
    const imageData = this.getImageData(this.currentImageObject);
    if (!imageData) return;
    
    // 生成圆形选区内的种子点
    const seedPoints = this.getCircleAreaSeedPoints(this.startPoint, radius, this.currentImageObject);
    
    // 执行洪水算法
    this.selectionMask = this.floodFill(imageData, seedPoints, this.options.tolerance || 32);
    
    // 创建选区蒙版并应用到图像对象
    this.createSelectionMask();
    this.applySelectionToImage();
  }

  private getImageData(imageObj: ImageObject): ImageData | null {
    try {
      // 创建临时画布来获取图像数据
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      
      tempCanvas.width = imageObj.width;
      tempCanvas.height = imageObj.height;
      
      // 绘制图像到临时画布
      tempCtx.drawImage(imageObj.getImage(), 0, 0);
      
      return tempCtx.getImageData(0, 0, imageObj.width, imageObj.height);
    } catch (error) {
      console.error('Failed to get image data:', error);
      return null;
    }
  }

  private getCircleAreaSeedPoints(center: Point, radius: number, imageObj: ImageObject): Point[] {
    const localCenter = this.worldToImageLocal(center, imageObj);
    const localRadius = radius / Math.min(imageObj.transform.scaleX, imageObj.transform.scaleY) / this.editor.viewport.zoom;
    
    const seedPoints: Point[] = [];
    
    // 在圆形区域内采样种子点
    const sampleStep = Math.max(1, Math.floor(localRadius / 10)); // 根据半径调整采样密度
    
    for (let x = Math.floor(localCenter.x - localRadius); x <= Math.ceil(localCenter.x + localRadius); x += sampleStep) {
      for (let y = Math.floor(localCenter.y - localRadius); y <= Math.ceil(localCenter.y + localRadius); y += sampleStep) {
        // 检查点是否在圆形内
        const dx = x - localCenter.x;
        const dy = y - localCenter.y;
        if (dx * dx + dy * dy <= localRadius * localRadius) {
          // 检查点是否在图像范围内
          if (x >= 0 && x < imageObj.width && y >= 0 && y < imageObj.height) {
            seedPoints.push({ x, y });
          }
        }
      }
    }
    
    return seedPoints;
  }

  private floodFill(imageData: ImageData, seedPoints: Point[], tolerance: number): Uint8Array {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    
    // 收集所有种子点的颜色
    const seedColors: { r: number, g: number, b: number }[] = [];
    for (const seed of seedPoints) {
      const index = (seed.y * width + seed.x) * 4;
      if (index >= 0 && index < data.length) {
        seedColors.push({
          r: data[index],
          g: data[index + 1],
          b: data[index + 2]
        });
      }
    }
    
    // 如果没有有效的种子点，返回空蒙版
    if (seedColors.length === 0) {
      return mask;
    }
    
    // 使用广度优先搜索进行洪水填充
    const queue: Point[] = [...seedPoints];
    
    // 标记种子点为已访问
    for (const seed of seedPoints) {
      const maskIndex = seed.y * width + seed.x;
      if (maskIndex >= 0 && maskIndex < visited.length) {
        visited[maskIndex] = 1;
        mask[maskIndex] = 255;
      }
    }
    
    const directions = [
      { x: -1, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: -1 }, { x: 0, y: 1 }
    ];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      for (const dir of directions) {
        const newX = current.x + dir.x;
        const newY = current.y + dir.y;
        
        if (newX < 0 || newX >= width || newY < 0 || newY >= height) {
          continue;
        }
        
        const maskIndex = newY * width + newX;
        if (visited[maskIndex]) {
          continue;
        }
        
        const pixelIndex = (newY * width + newX) * 4;
        const pixelColor = {
          r: data[pixelIndex],
          g: data[pixelIndex + 1],
          b: data[pixelIndex + 2]
        };
        
        // 检查是否与任何种子颜色匹配
        let matches = false;
        for (const seedColor of seedColors) {
          if (this.isColorSimilar(pixelColor, seedColor, tolerance)) {
            matches = true;
            break;
          }
        }
        
        if (matches) {
          visited[maskIndex] = 1;
          mask[maskIndex] = 255;
          queue.push({ x: newX, y: newY });
        }
      }
    }
    
    return mask;
  }

  private isColorSimilar(color1: { r: number, g: number, b: number }, color2: { r: number, g: number, b: number }, tolerance: number): boolean {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    
    // 使用欧几里得距离
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    return distance <= tolerance;
  }

  private createSelectionMask(): void {
    if (!this.selectionMask || !this.currentImageObject) return;
    
    const width = this.currentImageObject.width;
    const height = this.currentImageObject.height;
    
    // 创建选区蒙版画布
    this.selectionCanvas = document.createElement('canvas');
    this.selectionCtx = this.selectionCanvas.getContext('2d')!;
    this.selectionCanvas.width = width;
    this.selectionCanvas.height = height;
    
    // 将蒙版数据转换为可视化的画布
    const imageData = this.selectionCtx.createImageData(width, height);
    const data = imageData.data;
    
    for (let i = 0; i < this.selectionMask.length; i++) {
      const pixelIndex = i * 4;
      const maskValue = this.selectionMask[i];
      
      if (maskValue > 0) {
        // 设置选区颜色
        const color = this.hexToRgb(this.options.selectionColor || '#00FF00');
        data[pixelIndex] = color.r;     // R
        data[pixelIndex + 1] = color.g; // G
        data[pixelIndex + 2] = color.b; // B
        data[pixelIndex + 3] = Math.floor(255 * (this.options.selectionOpacity || 0.3)); // A
      } else {
        // 透明区域
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 0;
      }
    }
    
    this.selectionCtx.putImageData(imageData, 0, 0);
  }

  private applySelectionToImage(): void {
    if (!this.selectionCanvas || !this.currentImageObject) return;
    
    // 将选区蒙版应用到图像对象
    (this.currentImageObject as any).selectionCanvas = this.selectionCanvas;
    (this.currentImageObject as any).selectionCtx = this.selectionCtx;
    (this.currentImageObject as any).hasSelection = true;
    
    // 请求重渲染
    this.editor.requestRender();
  }

  private worldToImageLocal(worldPoint: Point, imageObj: ImageObject): Point {
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

  private hexToRgb(hex: string): { r: number, g: number, b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 255, b: 0 };
  }

  // 公共方法
  public enable(): void {
    this.options.enabled = true;
    this.editor.emit('colorSelection:enabled');
  }

  public disable(): void {
    this.options.enabled = false;
    this.isSelecting = false;
    this.startPoint = null;
    this.currentPoint = null;
    this.currentImageObject = null;
    this.editor.emit('colorSelection:disabled');
  }

  public setTolerance(tolerance: number): void {
    this.options.tolerance = Math.max(0, Math.min(255, tolerance));
    this.editor.emit('colorSelection:tolerance-changed', { tolerance: this.options.tolerance });
  }

  public setSelectionColor(color: string): void {
    this.options.selectionColor = color;
    this.editor.emit('colorSelection:color-changed', { color });
  }

  public setSelectionOpacity(opacity: number): void {
    this.options.selectionOpacity = Math.max(0, Math.min(1, opacity));
    this.editor.emit('colorSelection:opacity-changed', { opacity: this.options.selectionOpacity });
  }

  public clearSelection(): void {
    this.selectionMask = null;
    this.selectionCanvas = null;
    this.selectionCtx = null;
    
    // 清除所有图像对象的选区
    const objects = this.editor.objectManager.getAllObjects();
    objects.forEach((obj: any) => {
      if (obj instanceof ImageObject) {
        delete (obj as any).selectionCanvas;
        delete (obj as any).selectionCtx;
        delete (obj as any).hasSelection;
      }
    });
    
    this.editor.requestRender();
    this.editor.emit('colorSelection:cleared');
  }

  public getSelectionMask(): Uint8Array | null {
    return this.selectionMask;
  }
}