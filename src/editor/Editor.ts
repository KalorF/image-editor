// 主编辑器类
import { SelectionBox } from './controls/SelectionBox';
import { EventEmitter } from './core/EventEmitter';
import { HistoryManager } from './core/HistoryManager';
import { HookManager } from './core/HookManager';
import { ObjectManager } from './core/ObjectManager';
import { PluginManager } from './core/PluginManager';
import { Viewport } from './core/Viewport';
import { BaseObject } from './objects/BaseObject';
import { ImageObject } from './objects/ImageObject';
import type { EditorTool, Plugin, Point } from './types';
import { EditorEvents, EditorHooks, EditorRenderType } from './types';
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
  enableHistory?: boolean; // 新增：启用内置历史
  renderFPS?: number; // 渲染帧率
  history?: {
    maxHistorySize?: number;
    captureInterval?: number;
  };
  zoomOptions?: {
    minZoom?: number;
    maxZoom?: number;
  };
  plugins?: Plugin<Editor>[];
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
  public history: HistoryManager | null = null;

  // 配置选项
  private options: EditorOptions;
  private backgroundColor: string = '#FFFFFF';

  // 交互状态
  private isInitialized: boolean = false;
  private animationFrame: number | null = null;
  private needsRender: boolean = true;
  private renderFPS: number = 120;

  // 选择状态
  private selectedObject: BaseObject | null = null;
  private multiSelection: BaseObject[] = [];

  // 工具状态
  private currentTool: EditorTool = 'select';

  // 空格键移动画布状态
  private isSpacePressed: boolean = false;
  public isPanning: boolean = false;
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
    this.viewport = new Viewport(
      this.canvas,
      this.options.zoomOptions || { minZoom: 0.05, maxZoom: 100 },
    );
    this.objectManager = new ObjectManager();
    this.selectionBox = new SelectionBox({ viewport: this.viewport, canvas: this.canvas });

    // 历史管理（默认启用，可通过配置关闭）
    if (options.enableHistory !== false) {
      this.history = new HistoryManager(this, options.history);
    }

    // 绑定事件
    this.bindEvents();

    // 设置渲染帧率
    this.renderFPS = options.renderFPS || 120;

    // 安装默认插件
    if (options.plugins) {
      options.plugins.forEach(plugin => this.plugins.use(plugin));
    }

    // 初始化渲染（只在需要时启动循环）
    this.requestRender();

    this.isInitialized = true;
    this.emit(EditorEvents.EDITOR_INITIALIZED, { editor: this });
  }

  // 创建画布
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    // canvas.style.display = 'block';
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
    this.canvas.addEventListener('pointerleave', this.handleMouseLeave.bind(this));
    this.canvas.addEventListener('pointerenter', this.handleMouseEnter.bind(this));
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));

    // 键盘事件
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));

    // 视口事件
    this.viewport.on(EditorEvents.VIEWPORT_ZOOM, ({ zoom }) => {
      this.emit(EditorEvents.VIEWPORT_ZOOM, { zoom });
      this.requestRender(EditorRenderType.TRANSFORM_ONLY);
    });
    this.viewport.on(EditorEvents.VIEWPORT_PAN, () => {
      this.emit(EditorEvents.VIEWPORT_PAN, { panX: this.viewport.panX, panY: this.viewport.panY });
      this.requestRender(EditorRenderType.TRANSFORM_ONLY);
    });
    this.viewport.on(EditorEvents.VIEWPORT_RESIZE, ({ zoom }) => {
      this.zoomToFit(zoom);
      this.emit(EditorEvents.VIEWPORT_RESIZE, {
        width: this.viewport.width,
        height: this.viewport.height,
      });
      this.hooks.trigger(EditorHooks.RESIZE_CANVAS, this.ctx);
      this.requestRender();
    });

    // 对象管理器事件
    this.objectManager.on(EditorEvents.OBJECT_ADDED, data => {
      this.emit(EditorEvents.OBJECT_ADDED, data);
      this.requestRender();
    });
    this.objectManager.on(EditorEvents.OBJECT_REMOVED, data => {
      this.emit(EditorEvents.OBJECT_REMOVED, data);
      this.requestRender();
    });
    this.objectManager.on(EditorEvents.OBJECT_MOVED, data => {
      this.emit(EditorEvents.OBJECT_MOVED, data);
      this.requestRender();
    });
    this.objectManager.on(EditorEvents.OBJECT_SCALED, data => {
      this.emit(EditorEvents.OBJECT_SCALED, data);
      this.requestRender();
    });
    this.objectManager.on(EditorEvents.OBJECT_ROTATED, data => {
      this.emit(EditorEvents.OBJECT_ROTATED, data);
      this.requestRender();
    });
    this.objectManager.on(EditorEvents.OBJECT_RESIZED, data => {
      this.emit(EditorEvents.OBJECT_RESIZED, data);
      this.requestRender();
    });

    // 选择框事件
    this.selectionBox.on(EditorEvents.SELECTION_CHANGED, (data: any) => {
      this.selectedObject = data.newTarget;
      this.emit(EditorEvents.SELECTION_CHANGED, data);
      this.requestRender();
    });

    this.selectionBox.on(EditorEvents.DRAG_START, event => {
      this.emit(EditorEvents.OBJECT_DRAG_START, event);
    });

    this.selectionBox.on(EditorEvents.DRAG_MOVE, event => {
      this.hooks.trigger(EditorHooks.OBJECT_DRAG_MOVE, event);
      this.emit(EditorEvents.OBJECT_DRAG_MOVE, event || {});
      this.requestRender();
    });

    this.selectionBox.on(EditorEvents.DRAG_END, (event: any) => {
      this.hooks.trigger(EditorHooks.OBJECT_DRAG_END, event);
      this.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'After transform');
      this.emit(EditorEvents.OBJECT_DRAG_END, event || {});
    });
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.handleMouseDown);
    this.canvas.removeEventListener('pointermove', this.handleMouseMove);
    this.canvas.removeEventListener('pointerup', this.handleMouseUp);
    this.canvas.removeEventListener('pointerleave', this.handleMouseLeave);
    this.canvas.removeEventListener('pointerenter', this.handleMouseEnter);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  // 鼠标事件处理
  private handleMouseDown(event: MouseEvent): void {
    // this.canvas.focus();

    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);
    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && this.isSpacePressed && event.button === 0) {
      event.preventDefault();
      this.isPanning = true;
      this.lastPanPoint = point;
      this.updateCanvasCursor('grabbing');
      this.emit(EditorEvents.PAN_START, { point: worldPoint, event });
      return;
    }

    // 触发钩子
    const hookResults = this.hooks.trigger(EditorHooks.MOUSE_DOWN, worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }

    // 选择框处理
    if (this.options.enableSelection !== false && this.currentTool === 'select') {
      const handled = this.selectionBox.handleMouseDown(worldPoint, event);
      if (handled) {
        this.emit(EditorEvents.MOUSE_DOWN, { point: worldPoint, event, handled: true });
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

    this.emit(EditorEvents.MOUSE_DOWN, { point: worldPoint, event, handled: false });
  }

  private handleMouseMove(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    // 触发钩子
    const hookResults = this.hooks.trigger(EditorHooks.MOUSE_MOVE, worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }

    // 空格键移动画布功能
    if (this.isPanning) {
      const deltaX = point.x - this.lastPanPoint.x;
      const deltaY = point.y - this.lastPanPoint.y;

      this.viewport.pan(deltaX, deltaY);
      this.lastPanPoint = point;
      this.emit(EditorEvents.PAN_MOVE, { point: worldPoint, deltaX, deltaY, event });
      return;
    }

    // 选择框处理
    if (this.options.enableSelection !== false) {
      this.selectionBox.handleMouseMove(worldPoint);
    }

    this.emit(EditorEvents.MOUSE_MOVE, { point: worldPoint, event });
  }

  private handleMouseUp(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    // 触发钩子
    const hookResults = this.hooks.trigger(EditorHooks.MOUSE_UP, worldPoint, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }

    // 空格键移动画布功能
    if (this.isPanning) {
      this.isPanning = false;
      this.updateCanvasCursor(this.isSpacePressed ? 'grab' : 'default', event);
      this.emit(EditorEvents.PAN_END, { point: worldPoint, event });
      return;
    }

    // 选择框处理
    if (this.options.enableSelection !== false) {
      this.selectionBox.handleMouseUp();
    }

    this.emit(EditorEvents.MOUSE_UP, { point: worldPoint, event });
  }

  private handleClick(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    this.hooks.trigger(EditorHooks.MOUSE_CLICK, worldPoint, event);
    this.emit(EditorEvents.MOUSE_CLICK, { point: worldPoint, event });
  }

  private handleDoubleClick(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    this.hooks.trigger(EditorHooks.MOUSE_DOUBLE_CLICK, worldPoint, event);
    this.emit(EditorEvents.MOUSE_DOUBLE_CLICK, { point: worldPoint, event });
  }

  private handleMouseLeave(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    const hookResults = this.hooks.trigger(EditorHooks.MOUSE_LEAVE, worldPoint, event);

    // 如果有钩子处理了事件，则停止后续处理
    if (hookResults.beforeResults.some((result: any) => result === true)) {
      return;
    }

    this.emit(EditorEvents.MOUSE_LEAVE, { point: worldPoint, event });
  }

  private handleMouseEnter(event: MouseEvent): void {
    const point = this.getMousePoint(event);
    const worldPoint = this.viewport.screenToWorld(point);

    const hookResults = this.hooks.trigger(EditorHooks.MOUSE_ENTER, worldPoint, event);

    // 如果有钩子处理了事件，则停止后续处理
    if (hookResults.beforeResults.some((result: any) => result === true)) {
      return;
    }

    this.emit(EditorEvents.MOUSE_ENTER, { point: worldPoint, event });
  }

  // 键盘事件处理
  private handleKeyDown(event: KeyboardEvent): void {
    // 触发钩子
    const hookResults = this.hooks.trigger(EditorHooks.KEY_DOWN, event);
    if (hookResults.beforeResults.includes(false)) {
      return;
    }

    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && event.key === ' ') {
      if (!this.isSpacePressed) {
        this.isSpacePressed = true;
        this.updateCanvasCursor('grab');
        this.emit(EditorEvents.SPACE_DOWN, { event });
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
      const key = (event.key || '').toLowerCase();
      switch (key) {
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
        case 'y':
          // Windows/Linux 常见重做快捷键 Ctrl+Y
          this.redo();
          event.preventDefault();
          break;
      }
    }

    this.emit(EditorEvents.KEY_DOWN, { event });
  }

  private handleKeyUp(event: KeyboardEvent): void {
    // 空格键移动画布功能
    if (this.options.enableSpacePan !== false && event.key === ' ') {
      this.isSpacePressed = false;
      if (!this.isPanning) {
        this.updateCanvasCursor('default');
      }
      this.emit(EditorEvents.SPACE_UP, { event });
      return;
    }

    this.hooks.trigger(EditorHooks.KEY_UP, event);
    this.emit(EditorEvents.KEY_UP, { event });
  }

  // 获取鼠标在画布上的位置
  private getMousePoint(event: MouseEvent): Point {
    return MathUtils.getCanvasMousePoint(event, this.canvas);
  }

  // 对象操作
  addObject(object: BaseObject, layerId?: string, needRecord = true): void {
    this.hooks.trigger(EditorHooks.OBJECT_BEFORE_ADD, object);
    this.objectManager.addObject(object, layerId);
    this.hooks.trigger(EditorHooks.OBJECT_AFTER_ADD, object);
    if (needRecord) {
      this.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Added object');
    }
    this.requestRender();
  }

  removeObject(object: BaseObject): void {
    this.hooks.trigger(EditorHooks.OBJECT_BEFORE_REMOVE, object);

    if (this.selectedObject === object) {
      this.clearSelection();
    }

    this.objectManager.removeObject(object);
    this.hooks.trigger(EditorHooks.OBJECT_AFTER_REMOVE, object);
    console.log('removeObject', object);
    this.hooks.trigger(EditorHooks.HISTORY_CAPTURE, 'Removed object');
    this.requestRender();
  }

  updateCanvasCursor(cursor: string, event?: MouseEvent, needEmit = true): void {
    this.canvas.style.cursor = cursor;
    if (needEmit) {
      this.emit(EditorEvents.CANVAS_CURSOR_UPDATED, { cursor, event });
    }
  }

  // 选择操作
  selectObject(object: BaseObject): void {
    if (this.selectedObject === object) {
      return;
    }

    this.hooks.trigger(EditorHooks.OBJECT_BEFORE_SELECT, object);
    this.selectedObject = object;
    this.selectionBox.setTarget(object);
    this.hooks.trigger(EditorHooks.OBJECT_AFTER_SELECT, object);
    this.emit(EditorEvents.OBJECT_SELECTED, { object });
  }

  clearSelection(): void {
    if (!this.selectedObject) {
      return;
    }

    const oldSelection = this.selectedObject;
    this.selectedObject = null;
    this.selectionBox.setTarget(null);
    this.emit(EditorEvents.OBJECT_DESELECTED, { object: oldSelection });
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
      this.emit(EditorEvents.OBJECT_COPIED, { object: this.selectedObject });
    }
  }

  paste(): void {
    if (this.clipboard) {
      // 这里需要对象工厂来创建具体的对象
      // 暂时不实现具体功能
      this.emit(EditorEvents.OBJECT_PASTE_ATTEMPTED, { data: this.clipboard });
    }
  }

  // 撤销重做（简单实现）
  undo(): void {
    if (this.history && this.history.isEnabled()) {
      this.history.undo();
    } else {
      this.emit(EditorEvents.EDIT_UNDO, {});
    }
  }

  redo(): void {
    if (this.history && this.history.isEnabled()) {
      this.history.redo();
    } else {
      this.emit(EditorEvents.EDIT_REDO, {});
    }
  }

  // 工具管理
  setTool(tool: EditorTool): void {
    const oldTool = this.currentTool;
    this.currentTool = tool;
    this.emit(EditorEvents.TOOL_CHANGED, { oldTool, newTool: tool });
  }

  getCurrentTool(): string {
    return this.currentTool;
  }

  getTool(): EditorTool {
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
    this.emit(EditorEvents.SPACE_PAN_ENABLED, {});
  }

  disableSpacePan(): void {
    this.options.enableSpacePan = false;
    this.isSpacePressed = false;
    this.isPanning = false;
    this.updateCanvasCursor('default');
    this.emit(EditorEvents.SPACE_PAN_DISABLED, {});
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
  addImage({
    src,
    x,
    y,
    needRecord = true,
  }: {
    src: string;
    x?: number;
    y?: number;
    needRecord?: boolean;
  }): Promise<ImageObject> {
    return new Promise((resolve, reject) => {
      // 预计算目标中心点（世界坐标）
      // 未传坐标：以当前视图中心为基准（将屏幕中心转换为世界坐标）
      const screenCenter = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
      const worldCenter = this.viewport.screenToWorld(screenCenter);

      // 先创建对象，位置暂定为世界中心（最终会在加载后再精确设置）
      const imageObject = new ImageObject(src, {
        transform: { x: worldCenter.x, y: worldCenter.y, scaleX: 1, scaleY: 1, rotation: 0 },
        type: 'image',
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
          imageObject.setPosition(
            topLeftWorld.x + scaledWidth / 2,
            topLeftWorld.y + scaledHeight / 2,
          );
        } else {
          // 否则放在当前视图中心（世界坐标）
          imageObject.setPosition(worldCenter.x, worldCenter.y);
        }

        this.addObject(imageObject, undefined, needRecord);

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

  async importByJson(
    json: Array<{ src: string; x?: number; y?: number; type: string } | BaseObject>,
  ): Promise<void> {
    for (let i = 0; i < json.length; i++) {
      const obj = json[i];
      if (obj.type === 'image') {
        // 类型断言确保obj是包含图片数据的对象
        const imageData = obj as { src: string; x: number; y: number; type: string };
        await this.addImage({
          src: imageData.src,
          x: imageData.x,
          y: imageData.y,
          needRecord: false,
        });
      }
    }
    if (this.history) {
      this.history.setInitialState(this.getState());
    }
  }

  // 处理图片加载队列
  private processImageQueue(): void {
    if (
      this.isProcessingQueue ||
      this.currentLoads >= this.maxConcurrentLoads ||
      this.imageLoadQueue.length === 0
    ) {
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
  scaleImageToFit(imageObject: ImageObject): number {
    // 获取视口尺寸
    const viewportWidth = this.viewport.width;
    const viewportHeight = this.viewport.height;

    const maxWidth = viewportWidth * 0.9;
    const maxHeight = viewportHeight * 0.9;

    // 如果图片尺寸超过最大尺寸，按比例缩放
    if (imageObject.width > maxWidth || imageObject.height > maxHeight) {
      const scaleX = maxWidth / imageObject.width;
      const scaleY = maxHeight / imageObject.height;
      const scale = Math.min(scaleX, scaleY); // 保持宽高比

      imageObject.setScale(scale, scale);
      return scale;
    }
    return 1;
  }

  // 渲染循环管理
  private isRenderLoopActive: boolean = false;
  private renderSuspendCount = 0;

  // 启动渲染循环
  private startRenderLoop(type: EditorRenderType): void {
    if (this.isRenderLoopActive) return;

    this.isRenderLoopActive = true;
    let lastRenderTime = 0;
    const frameInterval = 1000 / this.renderFPS;
    let idleFrames = 0;
    const maxIdleFrames = 10; // 连续10帧没有渲染请求后停止循环

    const render = (currentTime: number) => {
      // 检查是否需要渲染
      if (this.needsRender) {
        // 限制帧率，但确保不会跳过太多帧
        if (currentTime - lastRenderTime >= frameInterval) {
          this.render(type);
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

  requestRender(type: EditorRenderType = EditorRenderType.FULL): void {
    this.needsRender = true;
    // 若渲染被挂起，则仅记录需要渲染，等待恢复后统一渲染
    if (this.renderSuspendCount > 0) {
      return;
    }
    // 如果渲染循环未激活，启动它
    if (!this.isRenderLoopActive) {
      this.startRenderLoop(type);
    }
  }

  // 渲染挂起/恢复（用于批量状态更新避免闪烁）
  suspendRendering(): void {
    this.renderSuspendCount++;
  }

  resumeRendering(forceRender: boolean = true): void {
    if (this.renderSuspendCount > 0) {
      this.renderSuspendCount--;
    }
    if (this.renderSuspendCount === 0) {
      if (forceRender) {
        this.requestRender();
      }
    }
  }

  private render(type: EditorRenderType): void {
    // 批量状态更新期间不渲染，避免中间空帧导致闪烁
    if (this.renderSuspendCount > 0) {
      // 清除当前渲染请求，等待恢复后再渲染
      this.needsRender = false;
      return;
    }

    // 重置变换矩阵并完全清除画布
    this.ctx.resetTransform();
    // 使用canvas的实际尺寸来确保完全清除
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 触发渲染前钩子（在背景之后，用于绘制网格等背景元素）
    this.hooks.trigger(EditorHooks.RENDER_BEFORE, this.ctx);

    // 应用视口变换（内部已包含DPR缩放）
    this.viewport.applyTransform(this.ctx);

    // 绘制背景
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    // 渲染所有对象（传递视口信息用于视野裁剪）
    // NOTE: 如需视野裁剪，可在此计算 viewport 信息
    this.objectManager.renderAll(this.ctx, type);

    // 渲染选择框
    this.selectionBox.render(this.ctx);

    // 触发渲染后钩子
    this.hooks.trigger(EditorHooks.RENDER_AFTER, this.ctx);

    this.emit(EditorEvents.EDITOR_RENDERED, {});
  }

  zoomIn(): void {
    this.viewport.smartZoom(this.viewport.zoomStep);
  }

  zoomOut(): void {
    this.viewport.smartZoom(-this.viewport.zoomStep);
  }

  zoomTo(zoom: number): void {
    this.viewport.smartZoom(zoom, true);
  }

  zoomInToCenter(): void {
    this.viewport.clearZoomMemory();
    this.viewport.smartZoom(this.viewport.zoomStep);
  }

  zoomOutToCenter(): void {
    this.viewport.clearZoomMemory();
    this.viewport.smartZoom(-this.viewport.zoomStep);
  }

  zoomInToMouse(): void {
    const currentZoom = this.viewport.zoom;
    this.viewport.setZoom(
      currentZoom + this.viewport.zoomStep,
      this.viewport.getZoomCenter()
        ? this.viewport.screenToWorld(this.viewport.getZoomCenter()!)
        : undefined,
    );
  }

  zoomOutToMouse(): void {
    const currentZoom = this.viewport.zoom;
    this.viewport.setZoom(
      currentZoom - this.viewport.zoomStep,
      this.viewport.getZoomCenter()
        ? this.viewport.screenToWorld(this.viewport.getZoomCenter()!)
        : undefined,
    );
  }

  clearZoomMemory(): void {
    this.viewport.clearZoomMemory();
  }

  getZoomInfo(): { hasMouseMemory: boolean; center: Point | null; timeLeft: number } {
    const center = this.viewport.getZoomCenter();
    return {
      hasMouseMemory: center !== null,
      center,
      timeLeft: center ? 3000 - (performance.now() - (this.viewport as any).lastZoomTime) : 0,
    };
  }

  zoomToFit(_zoom?: number): void {
    this.viewport.clearZoomMemory();
    this.viewport.resetViewport();
    this.viewport.smartZoom(1, true);
  }

  resetZoom(): void {
    this.viewport.clearZoomMemory();
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
    this.objectManager.renderAll(tempCtx, EditorRenderType.FULL);

    return tempCanvas.toDataURL(type, quality);
  }

  // 获取编辑器状态
  getState(): any {
    return {
      viewport: this.viewport.getState(),
      objects: this.objectManager.toJSON(),
      selectedObjectId: this.selectedObject?.id || null,
      currentTool: this.currentTool,
    };
  }

  // 设置编辑器状态
  setState(state: any): void {
    if (state.viewport) {
      this.viewport.setState(state.viewport);
    }

    if (state.objects) {
      // 重建对象集合
      try {
        // 清空当前对象
        this.objectManager.clear();
        const data = state.objects;
        const objectsArray: any[] = Array.isArray(data.objects) ? data.objects : [];
        for (const objData of objectsArray) {
          let obj: BaseObject | null = null;
          if (objData.type === 'image') {
            obj = ImageObject.fromJSON(objData);
          }
          // 可在此扩展其他类型工厂
          if (obj) {
            // 尽量保留原ID
            if (objData.id) {
              (obj as any).id = objData.id;
            }
            // 确保异步资源就绪后能触发重渲染
            (obj as any).once?.('image:loaded', () => this.requestRender());
            (obj as any).once?.('image:error', () => this.requestRender());
            this.addObject(obj, undefined, false);
          }
        }
      } catch (e) {
        console.error('Failed to rebuild objects from state:', e);
      }
    }

    // 不需要进行工具切换
    // if (state.currentTool) {
    //   this.setTool(state.currentTool);
    // }

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

    // 清理历史
    if (this.history) {
      this.history.destroy();
      this.history = null;
    }

    // 清理组件
    this.viewport.destroy();
    this.selectionBox.destroy();
    this.objectManager.clear();

    // 移除画布
    this.canvas.remove();

    this.unbindEvents();

    // 清理事件
    this.removeAllListeners();

    this.emit(EditorEvents.EDITOR_DESTROYED, {});
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

  // 历史开关
  enableHistory(): void {
    if (!this.history) {
      this.history = new HistoryManager(this, this.options.history);
    } else {
      this.history.enable();
    }
    this.emit(EditorEvents.HISTORY_ENABLED, {});
  }

  disableHistory(): void {
    if (this.history) {
      this.history.disable();
    }
    this.emit(EditorEvents.HISTORY_DISABLED, {});
  }

  isHistoryEnabled(): boolean {
    return !!this.history && this.history.isEnabled();
  }
}

export type EditorType = Editor;
