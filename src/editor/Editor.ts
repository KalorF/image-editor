// 主编辑器类
// 主编辑器类
import type { Point, Plugin } from './types';
import { EventEmitter } from './core/EventEmitter';
import { HookManager } from './core/HookManager';
import { PluginManager } from './core/PluginManager';
import { Viewport } from './core/Viewport';
import { ObjectManager } from './core/ObjectManager';
import { SelectionBox } from './controls/SelectionBox';
import { BaseObject } from './objects/BaseObject';
import { ImageObject } from './objects/ImageObject';
import { MathUtils } from './utils/math';

export interface EditorOptions {
  container: HTMLElement | string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  enableSelection?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  enableSpacePan?: boolean; // 新增：启用空格键移动画布功能
  plugins?: Plugin[];
}

export class Editor extends EventEmitter {
  // 容器和画布
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // 核心模块
  public viewport: Viewport;
  public objectManager: ObjectManager;
  public selectionBox: SelectionBox;
  public hooks: HookManager;
  public plugins: PluginManager;
  
  // 配置选项
  private options: EditorOptions;
  private backgroundColor: string = '#FFFFFF';
  
  // 交互状态
  private isInitialized: boolean = false;
  private animationFrame: number | null = null;
  private needsRender: boolean = true;
  
  // 选择状态
  private selectedObject: BaseObject | null = null;
  private multiSelection: BaseObject[] = [];
  
  // 工具状态
  private currentTool: string = 'select';
  
  // 空格键移动画布状态
  private isSpacePressed: boolean = false;
  private isPanning: boolean = false;
  private lastPanPoint: Point = { x: 0, y: 0 };

  constructor(options: EditorOptions) {
    super();
    
    this.options = { ...options };
    this.backgroundColor = options.backgroundColor || '#FFFFFF00';
    
    // 获取容器
    if (typeof options.container === 'string') {
      const element = document.querySelector(options.container);
      if (!element) {
        throw new Error(`Container element not found: ${options.container}`);
      }
      this.container = element as HTMLElement;
    } else {
      this.container = options.container;
    }
    
    // 创建画布
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    
    // 初始化核心模块
    this.hooks = new HookManager();
    this.plugins = new PluginManager(this);
    this.viewport = new Viewport(this.canvas);
    this.objectManager = new ObjectManager();
    this.selectionBox = new SelectionBox({ viewport: this.viewport, canvas: this.canvas });
    
    // 绑定事件
    this.bindEvents();
    
    // 安装默认插件
    if (options.plugins) {
      options.plugins.forEach(plugin => this.plugins.use(plugin));
    }
    
    // 初始化渲染（只在需要时启动循环）
    this.requestRender();
    
    this.isInitialized = true;
    this.emit('editor:initialized', { editor: this });
  }

  // 创建画布
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.outline = 'none';
    canvas.tabIndex = 1; // 允许获得焦点
    
    // 设置尺寸
    const width = this.options.width || this.container.clientWidth;
    const height = this.options.height || this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    this.container.appendChild(canvas);
    
    return canvas;
  }

  // 绑定事件
  private bindEvents(): void {
    // 画布事件
    this.canvas.addEventListener('pointerdown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('pointermove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('pointerup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    
    // 键盘事件
    this.canvas.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.canvas.addEventListener('keyup', this.handleKeyUp.bind(this));
    
    // 视口事件
    this.viewport.on('viewport:zoom', () => {
      this.emit('viewport:zoom', { zoom: this.viewport.zoom });
      this.requestRender();
    });
    this.viewport.on('viewport:pan', () => {
      this.emit('viewport:pan', { panX: this.viewport.panX, panY: this.viewport.panY });
      this.requestRender();
    });
    this.viewport.on('viewport:resize', () => {
      this.emit('viewport:resize', { width: this.viewport.width, height: this.viewport.height });
      this.requestRender();
    });
    
    // 对象管理器事件
    this.objectManager.on('object:added', (event) => {
      this.emit('object:added', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    this.objectManager.on('object:removed', (event) => {
      this.emit('object:removed', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    this.objectManager.on('object:moved', (event) => {
      this.emit('object:moved', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    this.objectManager.on('object:scaled', (event) => {
      this.emit('object:scaled', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    this.objectManager.on('object:rotated', (event) => {
      this.emit('object:rotated', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    this.objectManager.on('object:resized', (event) => {
      this.emit('object:resized', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    
    // 选择框事件
    this.selectionBox.on('selection:changed', (event: any) => {
      this.selectedObject = event.data.newTarget;
      this.emit('selection:changed', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    
    this.selectionBox.on('drag:start', (event: any) => {
      this.hooks.trigger('object:drag:start', event);
      this.emit('object:drag:start', event.data, event.target, event.originalEvent);
    });
    
    this.selectionBox.on('drag:move', (event: any) => {
      this.hooks.trigger('object:drag:move', event);
      this.emit('object:drag:move', event.data, event.target, event.originalEvent);
      this.requestRender();
    });
    
    this.selectionBox.on('drag:end', (event: any) => {
      this.hooks.trigger('object:drag:end', event);
      this.emit('object:drag:end', event.data, event.target, event.originalEvent);
    });
  }

  // 鼠标事件处理
  private handleMouseDown(event: MouseEvent): void {
    this.canvas.focus();
    
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    
    // 触发钩子
    const hookResults = this.hooks.trigger('mouse:down', worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }
    
    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && this.isSpacePressed && event.button === 0) {
      event.preventDefault();
      this.isPanning = true;
      this.lastPanPoint = point;
      this.canvas.style.cursor = 'grabbing';
      this.emit('pan:start', { point: worldPoint, event });
      return;
    }
    
    // 选择框处理
    if (this.options.enableSelection !== false && this.currentTool === 'select') {
      const handled = this.selectionBox.handleMouseDown(worldPoint, event);
      if (handled) {
        this.emit('mouse:down', { point: worldPoint, event, handled: true });
        return;
      }
    }
    
    // 对象选择
    if (this.currentTool === 'select') {
      const hitObject = this.objectManager.hitTest(worldPoint);
      if (hitObject) {
        this.selectObject(hitObject);
        this.selectionBox.handleMouseDown(worldPoint, event);
      } else {
        this.clearSelection();
      }
    }
    
    this.emit('mouse:down', { point: worldPoint, event, handled: false });
  }

  private handleMouseMove(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    
    // 触发钩子
    const hookResults = this.hooks.trigger('mouse:move', worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }
    
    // 空格键移动画布功能
    if (this.isPanning) {
      const deltaX = point.x - this.lastPanPoint.x;
      const deltaY = point.y - this.lastPanPoint.y;
      
      this.viewport.pan(deltaX, deltaY);
      this.lastPanPoint = point;
      this.emit('pan:move', { point: worldPoint, deltaX, deltaY, event });
      return;
    }
    
    // 选择框处理
    if (this.options.enableSelection !== false) {
      this.selectionBox.handleMouseMove(worldPoint);
    }
    
    this.emit('mouse:move', { point: worldPoint, event });
  }

  private handleMouseUp(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    
    // 触发钩子
    const hookResults = this.hooks.trigger('mouse:up', worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }
    
    // 空格键移动画布功能
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.isSpacePressed ? 'grab' : 'default';
      this.emit('pan:end', { point: worldPoint, event });
      return;
    }
    
    // 选择框处理
    if (this.options.enableSelection !== false) {
      this.selectionBox.handleMouseUp();
    }
    
    this.emit('mouse:up', { point: worldPoint, event });
  }

  private handleClick(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    
    this.hooks.trigger('mouse:click', worldPoint, event);
    this.emit('mouse:click', { point: worldPoint, event });
  }

  private handleDoubleClick(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    
    this.hooks.trigger('mouse:double-click', worldPoint, event);
    this.emit('mouse:double-click', { point: worldPoint, event });
  }

  // 键盘事件处理
  private handleKeyDown(event: KeyboardEvent): void {
    // 触发钩子
    const hookResults = this.hooks.trigger('key:down', event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }
    
    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && event.key === ' ') {
      if (!this.isSpacePressed) {
        this.isSpacePressed = true;
        this.canvas.style.cursor = 'grab';
        this.emit('space:down', { event });
      }
      event.preventDefault();
      return;
    }
    
    // 处理常用快捷键
    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelected();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this.clearSelection();
      event.preventDefault();
    } else if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case 'a':
          this.selectAll();
          event.preventDefault();
          break;
        case 'c':
          this.copySelected();
          event.preventDefault();
          break;
        case 'v':
          this.paste();
          event.preventDefault();
          break;
        case 'z':
          if (event.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
          event.preventDefault();
          break;
      }
    }
    
    this.emit('key:down', { event });
  }

  private handleKeyUp(event: KeyboardEvent): void {
    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && event.key === ' ') {
      this.isSpacePressed = false;
      if (!this.isPanning) {
        this.canvas.style.cursor = 'default';
      }
      this.emit('space:up', { event });
      return;
    }
    
    this.hooks.trigger('key:up', event);
    this.emit('key:up', { event });
  }

  // 获取鼠标在画布上的位置
  private getMousePoint(event: MouseEvent): Point {
    return MathUtils.getCanvasMousePoint(event, this.canvas);
  }

  // 对象操作
  addObject(object: BaseObject, layerId?: string): void {
    this.hooks.trigger('object:before-add', object);
    this.objectManager.addObject(object, layerId);
    this.hooks.trigger('object:after-add', object);
    this.requestRender();
  }

  removeObject(object: BaseObject): void {
    this.hooks.trigger('object:before-remove', object);
    
    if (this.selectedObject === object) {
      this.clearSelection();
    }
    
    this.objectManager.removeObject(object);
    this.hooks.trigger('object:after-remove', object);
    this.requestRender();
  }

  // 选择操作
  selectObject(object: BaseObject): void {
    if (this.selectedObject === object) {
      return;
    }
    
    this.hooks.trigger('object:before-select', object);
    this.selectedObject = object;
    this.selectionBox.setTarget(object);
    this.hooks.trigger('object:after-select', object);
    this.emit('object:selected', { object });
  }

  clearSelection(): void {
    if (!this.selectedObject) {
      return;
    }
    
    const oldSelection = this.selectedObject;
    this.selectedObject = null;
    this.selectionBox.setTarget(null);
    this.emit('object:deselected', { object: oldSelection });
  }

  getSelectedObject(): BaseObject | null {
    return this.selectedObject;
  }

  selectAll(): void {
    // 简单实现，选择第一个对象
    const objects = this.objectManager.getSelectableObjects();
    if (objects.length > 0) {
      this.selectObject(objects[0]);
    }
  }

  deleteSelected(): void {
    if (this.selectedObject) {
      this.removeObject(this.selectedObject);
    }
  }

  // 剪贴板操作（简单实现）
  private clipboard: any = null;

  copySelected(): void {
    if (this.selectedObject) {
      this.clipboard = this.selectedObject.toJSON();
      this.emit('object:copied', { object: this.selectedObject });
    }
  }

  paste(): void {
    if (this.clipboard) {
      // 这里需要对象工厂来创建具体的对象
      // 暂时不实现具体功能
      this.emit('object:paste-attempted', { data: this.clipboard });
    }
  }

  // 撤销重做（简单实现）
  undo(): void {
    this.emit('edit:undo');
  }

  redo(): void {
    this.emit('edit:redo');
  }

  // 工具管理
  setTool(tool: string): void {
    const oldTool = this.currentTool;
    this.currentTool = tool;
    this.emit('tool:changed', { oldTool, newTool: tool });
  }

  getCurrentTool(): string {
    return this.currentTool;
  }

  getTool(): string {
    return this.currentTool;
  }

  getObjectAt(point: Point): BaseObject | null {
    const objects = this.objectManager.getAllObjects();
    // 从后往前遍历（顶层优先）
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj.visible && obj.hitTest(point)) {
        return obj;
      }
    }
    return null;
  }

  // 空格键移动画布功能控制
  enableSpacePan(): void {
    this.options.enableSpacePan = true;
    this.emit('space-pan:enabled');
  }

  disableSpacePan(): void {
    this.options.enableSpacePan = false;
    this.isSpacePressed = false;
    this.isPanning = false;
    this.canvas.style.cursor = 'default';
    this.emit('space-pan:disabled');
  }

  isSpacePanEnabled(): boolean {
    return this.options.enableSpacePan !== false;
  }

  getSpacePressed(): boolean {
    return this.isSpacePressed;
  }

  // 批量加载队列
  private imageLoadQueue: (() => void)[] = [];
  private isProcessingQueue = false;
  private maxConcurrentLoads = 3; // 最大并发加载数
  private currentLoads = 0;

  // 添加图像
  addImage(src: string, x?: number, y?: number): Promise<ImageObject> {
    return new Promise((resolve, reject) => {
      // 预计算目标中心点（世界坐标）
      // 未传坐标：以当前视图中心为基准（将屏幕中心转换为世界坐标）
      const screenCenter = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
      const worldCenter = this.viewport.screenToWorld(screenCenter);

      // 先创建对象，位置暂定为世界中心（最终会在加载后再精确设置）
      const imageObject = new ImageObject(src, {
        transform: { x: worldCenter.x, y: worldCenter.y, scaleX: 1, scaleY: 1, rotation: 0 }
      });

      // 立即设置事件监听器，确保不会错过缓存加载的事件
      imageObject.once('image:loaded', () => {
        // 智能缩放：如果图片太大，自动缩放到合适大小
        this.scaleImageToFit(imageObject);

        // 如果传入了位置，按“左上角”语义进行定位
        if (typeof x === 'number' && typeof y === 'number') {
          const scaledWidth = imageObject.width * imageObject.transform.scaleX;
          const scaledHeight = imageObject.height * imageObject.transform.scaleY;
          // 传入的坐标按屏幕左上角计算，需要转换到世界坐标
          const topLeftWorld = this.viewport.screenToWorld({ x, y });
          imageObject.setPosition(topLeftWorld.x + scaledWidth / 2, topLeftWorld.y + scaledHeight / 2);
        } else {
          // 否则放在当前视图中心（世界坐标）
          imageObject.setPosition(worldCenter.x, worldCenter.y);
        }

        this.addObject(imageObject);

        this.currentLoads--;
        this.processImageQueue(); // 处理队列中的下一个

        resolve(imageObject);
      });

      imageObject.once('image:error', (event: any) => {
        this.currentLoads--;
        this.processImageQueue(); // 处理队列中的下一个
        reject(new Error(`Failed to load image: ${event.src}`));
      });

      // 添加到加载队列
      const loadTask = () => {
        this.currentLoads++;
        // 图像对象已经在构造函数中开始加载，这里不需要额外操作
      };

      this.imageLoadQueue.push(loadTask);
      this.processImageQueue();
    });
  }

  // 处理图片加载队列
  private processImageQueue(): void {
    if (this.isProcessingQueue || this.currentLoads >= this.maxConcurrentLoads || this.imageLoadQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.currentLoads < this.maxConcurrentLoads && this.imageLoadQueue.length > 0) {
      const task = this.imageLoadQueue.shift();
      if (task) {
        // 使用微任务延迟执行，避免阻塞
        setTimeout(task, 0);
      }
    }
    
    this.isProcessingQueue = false;
  }

  // 智能缩放图片到合适大小
  private scaleImageToFit(imageObject: ImageObject): void {
    // 获取视口尺寸
    const viewportWidth = this.viewport.width;
    const viewportHeight = this.viewport.height;
    
    // 设置最大尺寸为视口的60%，留出更多边距
    const maxWidth = viewportWidth * 0.5;
    const maxHeight = viewportHeight * 0.5;
    
    // 如果图片尺寸超过最大尺寸，按比例缩放
    if (imageObject.width > maxWidth || imageObject.height > maxHeight) {
      const scaleX = maxWidth / imageObject.width;
      const scaleY = maxHeight / imageObject.height;
      const scale = Math.min(scaleX, scaleY); // 保持宽高比
      
      imageObject.setScale(scale, scale);
      
    }
  }

  // 渲染循环管理
  private isRenderLoopActive: boolean = false;
  
  // 启动渲染循环
  private startRenderLoop(): void {
    if (this.isRenderLoopActive) return;
    
    this.isRenderLoopActive = true;
    let lastRenderTime = 0;
    const targetFPS = 120; // 降低到60fps，更稳定
    const frameInterval = 1000 / targetFPS;
    let idleFrames = 0;
    const maxIdleFrames = 10; // 连续10帧没有渲染请求后停止循环
    
    const render = (currentTime: number) => {
      // 检查是否需要渲染
      if (this.needsRender) {
        // 限制帧率，但确保不会跳过太多帧
        if (currentTime - lastRenderTime >= frameInterval) {
          this.render();
          this.needsRender = false;
          lastRenderTime = currentTime;
          idleFrames = 0; // 重置空闲帧计数
        }
      } else {
        idleFrames++;
      }
      
      // 如果连续多帧没有渲染请求，停止循环
      if (idleFrames >= maxIdleFrames) {
        this.isRenderLoopActive = false;
        this.animationFrame = null;
        return;
      }
      
      // 继续循环
      this.animationFrame = requestAnimationFrame(render);
    };
    
    this.animationFrame = requestAnimationFrame(render);
  }
  
  requestRender(): void {
    this.needsRender = true;
    
    // 移除防抖逻辑，直接启动渲染循环
    // 防抖逻辑与渲染循环的帧率限制产生冲突
    
    // 如果渲染循环未激活，启动它
    if (!this.isRenderLoopActive) {
      this.startRenderLoop();
    }
  }

  private render(): void {
    
    // 重置变换矩阵并完全清除画布
    this.ctx.resetTransform();
    // 使用canvas的实际尺寸来确保完全清除
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 触发渲染前钩子（在背景之后，用于绘制网格等背景元素）
    this.hooks.trigger('render:before', this.ctx);
    
    // 应用视口变换（内部已包含DPR缩放）
    this.viewport.applyTransform(this.ctx);
    
    // 绘制背景
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    
    // 渲染所有对象（传递视口信息用于视野裁剪）
    const viewportInfo = {
      x: -this.viewport.panX / this.viewport.zoom,
      y: -this.viewport.panY / this.viewport.zoom,
      width: this.viewport.width / this.viewport.zoom,
      height: this.viewport.height / this.viewport.zoom,
      zoom: this.viewport.zoom
    };
    this.objectManager.renderAll(this.ctx);
    
    // 渲染选择框
    if (this.options.enableSelection !== false) {
      this.selectionBox.render(this.ctx);
    }
    
    // 触发渲染后钩子
    this.hooks.trigger('render:after', this.ctx);
    
    this.emit('editor:rendered');
  }

  // 视口操作
  zoomIn(): void {
    const currentZoom = this.viewport.zoom;
    this.viewport.setZoom(currentZoom * 1.2);
  }

  zoomOut(): void {
    const currentZoom = this.viewport.zoom;
    this.viewport.setZoom(currentZoom / 1.2);
  }

  zoomToFit(): void {
    this.viewport.fitToCanvas();
  }

  resetZoom(): void {
    this.viewport.setZoom(1);
  }

  // 获取画布数据
  toDataURL(type?: string, quality?: number): string {
    // 创建临时画布用于导出
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    
    const devicePixelRatio = window.devicePixelRatio || 1;
    tempCanvas.width = this.viewport.width * devicePixelRatio;
    tempCanvas.height = this.viewport.height * devicePixelRatio;
    
    // 应用视口变换（内部已包含DPR缩放）
    this.viewport.applyTransform(tempCtx);
    
    // 绘制背景
    tempCtx.fillStyle = this.backgroundColor;
    tempCtx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    
    // 渲染所有对象
    this.objectManager.renderAll(tempCtx);
    
    return tempCanvas.toDataURL(type, quality);
  }

  // 获取编辑器状态
  getState(): any {
    return {
      viewport: this.viewport.getState(),
      objects: this.objectManager.toJSON(),
      selectedObjectId: this.selectedObject?.id || null,
      currentTool: this.currentTool
    };
  }

  // 设置编辑器状态
  setState(state: any): void {
    if (state.viewport) {
      this.viewport.setState(state.viewport);
    }
    
    if (state.objects) {
      // 这里需要对象工厂来重建对象
      // 暂时不实现
    }
    
    if (state.currentTool) {
      this.setTool(state.currentTool);
    }
    
    this.requestRender();
  }

  // 销毁编辑器
  destroy(): void {
    // 停止渲染循环
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // 重置渲染循环状态
    this.isRenderLoopActive = false;
    this.needsRender = false;
    
    // 清理插件
    this.plugins.uninstallAll();
    
    // 清理组件
    this.viewport.destroy();
    this.selectionBox.destroy();
    this.objectManager.clear();
    
    // 移除画布
    this.canvas.remove();
    
    // 清理事件
    this.removeAllListeners();
    
    this.emit('editor:destroyed');
  }

  // 获取画布元素
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // 获取画布上下文
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  // 检查是否已初始化
  isReady(): boolean {
    return this.isInitialized;
  }

  // DPR诊断方法
  getDPRInfo(): any {
    return MathUtils.getCanvasDPRInfo(this.canvas);
  }

  // 验证DPR设置是否正确
  validateDPR(): boolean {
    return MathUtils.validateCanvasDPR(this.canvas);
  }
}