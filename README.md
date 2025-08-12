# Canvas 图像编辑器框架

一个基于原生Canvas实现的模块化图像编辑器框架

## 🚀 特性

### 核心功能
- ✅ **画布缩放和移动** - 支持鼠标滚轮缩放、拖拽平移、空格键平移
- ✅ **图像编辑** - 完整的图像加载、变换、遮罩功能
- ✅ **OBB选择框** - 基于有向包围盒的精确选择，支持缩放、移动、旋转
- ✅ **历史记录** - 完整的撤销重做系统，支持自动状态捕获
- ✅ **模块化设计** - 清晰的模块划分，易于扩展和维护
- ✅ **插件系统** - 完整的插件架构，支持钩子机制
- ✅ **事件系统** - 完善的事件发射器，支持自定义事件
- ✅ **对象管理** - 支持图层管理、z-index排序、批量操作

### 交互功能
- 🖱️ **鼠标操作** - 完整的鼠标事件处理
- ⌨️ **键盘快捷键** - 删除、撤销、重做等快捷键
- 🎯 **精确选择** - 基于数学计算的精确hit-test
- 🔄 **实时预览** - 高性能的实时渲染系统
- 🎨 **智能选择** - 颜色选择工具，支持容差调整和预览
- 🖌️ **遮罩编辑** - 笔刷工具支持添加/删除遮罩区域

### 内置插件
- 🎨 **颜色选择插件** - 智能颜色选择工具，支持魔棒、容差调整、实时预览
- 🖌️ **遮罩笔刷插件** - 遮罩编辑工具，支持笔刷大小调整、添加/删除模式
- 📐 **网格插件** - 可配置的网格背景，支持普通网格和棋盘格模式
- 📜 **历史管理** - 撤销重做功能，支持历史记录管理和状态恢复

### 高级特性
- 🎯 **Web Worker优化** - 颜色选择使用Worker提升性能
- 🎭 **遮罩系统** - 完整的图像遮罩功能，支持透明度调整
- 📱 **高DPI支持** - 完美支持高分辨率屏幕
- ⚡ **性能优化** - 智能渲染、批量状态更新、内存管理

## 🏗️ 框架架构

### 核心模块

```
src/editor/
├── types.ts                    # 类型定义
├── index.ts                    # 入口文件
├── Editor.ts                   # 主编辑器类
├── core/                       # 核心模块
│   ├── EventEmitter.ts         # 事件发射器
│   ├── HookManager.ts          # 钩子管理器
│   ├── PluginManager.ts        # 插件管理器
│   ├── Viewport.ts             # 视口管理器（缩放、平移）
│   ├── ObjectManager.ts        # 对象管理器（图层、选择）
│   └── HistoryManager.ts       # 历史记录管理器
├── objects/                    # 渲染对象
│   ├── BaseObject.ts           # 基础对象类
│   └── ImageObject.ts          # 图像对象类（支持遮罩）
├── controls/                   # 控制器
│   └── SelectionBox.ts         # OBB选择框控制器
├── utils/                      # 工具类
│   └── math.ts                 # 数学工具函数
└── plugins/                    # 内置插件
    ├── ColorSelectionPlugin.ts # 颜色选择插件
    ├── MaskBrushPlugin.ts      # 遮罩笔刷插件
    ├── GridPlugin.ts           # 网格插件
    └── workers/                # Web Workers
        └── colorSelectionWorker.ts  # 颜色选择优化
```

### 设计模式

1. **事件驱动架构** - 所有模块通过事件进行通信
2. **插件化设计** - 功能可通过插件扩展
3. **钩子机制** - 允许在关键节点插入自定义逻辑
4. **面向对象** - 清晰的类继承关系
5. **组合模式** - 模块间松耦合，高内聚

## 📖 使用方法

### 基础使用

```typescript
import { createEditor } from './editor';
import { GridPlugin, ColorSelectionPlugin, MaskBrushPlugin } from './editor/plugins';

// 创建编辑器实例
const editor = createEditor({
  container: '#editor-container',
  width: 800,
  height: 600,
  backgroundColor: '#F5F5F5',
  enableSpacePan: true,  // 启用空格键平移
  enableHistory: true,   // 启用历史记录
  plugins: [
    new GridPlugin({ 
      size: 20, 
      color: '#E0E0E0',
      checkerboard: false  // 可选：棋盘格模式
    }),
    new ColorSelectionPlugin({
      tolerance: 32,
      selectionColor: '#FF0000',
      selectionOpacity: 0.5
    }),
    new MaskBrushPlugin({
      brushSize: 20,
      mode: 'add',
      opacity: 0.5
    })
  ]
});

// 添加图像
editor.addImage({
  src: 'path/to/image.jpg',
  x: 100,  // 可选：指定位置
  y: 100
}).then(imageObject => {
  console.log('图像添加成功:', imageObject);
  
  // 选择图像
  editor.selectObject(imageObject);
});

// 批量导入图像数据
const imageData = [
  { src: 'image1.jpg', x: 0, y: 0, type: 'image' },
  { src: 'image2.jpg', x: 200, y: 100, type: 'image' }
];
editor.importByJson(imageData);
```

### 事件监听

```typescript
// 监听选择变化
editor.on('selection:changed', (event) => {
  console.log('选择的对象:', event.data.newTarget);
});

// 监听对象变化
editor.on('object:moved', (event) => {
  console.log('对象移动:', event.data.object);
});

// 监听视口变化
editor.on('viewport:zoom', (event) => {
  console.log('缩放级别:', event.data.zoom);
});

// 监听历史记录变化
editor.on('history:undo', (event) => {
  console.log('撤销操作:', event.data.state);
});

// 监听空格键平移
editor.on('pan:start', (event) => {
  console.log('开始平移:', event.data.point);
});

// 监听编辑器初始化完成
editor.on('editor:initialized', () => {
  console.log('编辑器初始化完成');
});
```

### 插件功能使用

```typescript
// 使用颜色选择功能
const colorPlugin = editor.plugins.getPlugin('colorSelection');
if (colorPlugin) {
  // 设置容差
  colorPlugin.setTolerance(50);
  
  // 设置选择颜色
  colorPlugin.setSelectionColor('#00FF00');
  
  // 获取选择遮罩
  const mask = colorPlugin.getSelectionMask();
  
  // 清除当前选择
  colorPlugin.clearSelection();
}

// 使用遮罩笔刷功能
const brushPlugin = editor.plugins.getPlugin('maskBrush');
if (brushPlugin) {
  // 设置笔刷大小
  brushPlugin.setBrushSize(30);
  
  // 切换模式（添加/删除）
  brushPlugin.setMode('remove');
  
  // 清除遮罩
  brushPlugin.clearMask();
}

// 网格控制
const gridPlugin = editor.plugins.getPlugin('grid');
if (gridPlugin) {
  // 显示/隐藏网格
  gridPlugin.show();
  gridPlugin.hide();
  
  // 启用棋盘格模式
  gridPlugin.enableCheckerboard();
  gridPlugin.setCheckerboardColors('#FFFFFF', '#F0F0F0');
}
```

### 插件开发

#### 简单插件示例

```typescript
import { Plugin, Editor } from './editor';
import type { Point } from './editor/types';

class WatermarkPlugin implements Plugin {
  name = 'watermark';
  version = '1.0.0';
  
  private editor!: Editor;
  private text: string = 'Watermark';
  private enabled: boolean = true;
  
  install(editor: Editor): void {
    this.editor = editor;
    
    // 注册渲染钩子
    editor.hooks.after('render:after', this.renderWatermark.bind(this));
  }
  
  uninstall(editor: Editor): void {
    // 移除钩子
    editor.hooks.removeHook('render:after', this.renderWatermark, 'after');
  }
  
  private renderWatermark(ctx: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#999999';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    
    const centerX = this.editor.viewport.width / 2;
    const centerY = this.editor.viewport.height / 2;
    
    // 转换到世界坐标
    const worldCenter = this.editor.viewport.screenToWorld({ x: centerX, y: centerY });
    ctx.fillText(this.text, worldCenter.x, worldCenter.y);
    
    ctx.restore();
  }
  
  // 公共API
  public setText(text: string): void {
    this.text = text;
    this.editor.requestRender();
  }
  
  public enable(): void {
    this.enabled = true;
    this.editor.requestRender();
  }
  
  public disable(): void {
    this.enabled = false;
    this.editor.requestRender();
  }
}
```

#### 复杂交互插件示例

```typescript
class DrawingPlugin implements Plugin {
  name = 'drawing';
  version = '1.0.0';
  
  private editor!: Editor;
  private isDrawing: boolean = false;
  private currentPath: Point[] = [];
  private paths: Point[][] = [];
  private strokeColor: string = '#000000';
  private lineWidth: number = 2;
  
  install(editor: Editor): void {
    this.editor = editor;
    
    // 注册事件钩子
    editor.hooks.before('mouse:down', this.onMouseDown.bind(this));
    editor.hooks.before('mouse:move', this.onMouseMove.bind(this));
    editor.hooks.before('mouse:up', this.onMouseUp.bind(this));
    
    // 注册渲染钩子
    editor.hooks.after('render:after', this.renderPaths.bind(this));
    
    // 添加工具切换功能
    (editor as any).setDrawingMode = (enabled: boolean) => {
      this.setEnabled(enabled);
    };
  }
  
  uninstall(editor: Editor): void {
    // 清理钩子
    editor.hooks.removeHook('mouse:down', this.onMouseDown);
    editor.hooks.removeHook('mouse:move', this.onMouseMove);
    editor.hooks.removeHook('mouse:up', this.onMouseUp);
    editor.hooks.removeHook('render:after', this.renderPaths, 'after');
    
    // 清理扩展方法
    delete (editor as any).setDrawingMode;
  }
  
  private onMouseDown = (worldPoint: Point, event: MouseEvent): boolean => {
    if (this.editor.getTool() !== 'drawing') return true;
    
    this.isDrawing = true;
    this.currentPath = [worldPoint];
    
    // 返回false阻止默认行为
    return false;
  };
  
  private onMouseMove = (worldPoint: Point, event: MouseEvent): boolean => {
    if (!this.isDrawing || this.editor.getTool() !== 'drawing') return true;
    
    this.currentPath.push(worldPoint);
    this.editor.requestRender();
    
    return false;
  };
  
  private onMouseUp = (worldPoint: Point, event: MouseEvent): boolean => {
    if (!this.isDrawing) return true;
    
    this.isDrawing = false;
    if (this.currentPath.length > 1) {
      this.paths.push([...this.currentPath]);
      // 触发历史记录
      this.editor.hooks.trigger('history:capture', 'Drawing path');
    }
    this.currentPath = [];
    
    return false;
  };
  
  private renderPaths(ctx: CanvasRenderingContext2D): void {
    if (this.editor.getTool() !== 'drawing') return;
    
    ctx.save();
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.lineWidth / this.editor.viewport.zoom; // 保持线宽不变
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // 绘制已完成的路径
    this.paths.forEach(path => {
      this.drawPath(ctx, path);
    });
    
    // 绘制当前路径
    if (this.currentPath.length > 1) {
      this.drawPath(ctx, this.currentPath);
    }
    
    ctx.restore();
  }
  
  private drawPath(ctx: CanvasRenderingContext2D, path: Point[]): void {
    if (path.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    
    ctx.stroke();
  }
  
  // 公共API
  public setStrokeColor(color: string): void {
    this.strokeColor = color;
  }
  
  public setLineWidth(width: number): void {
    this.lineWidth = width;
  }
  
  public clearPaths(): void {
    this.paths = [];
    this.editor.requestRender();
    this.editor.hooks.trigger('history:capture', 'Clear drawing');
  }
  
  private setEnabled(enabled: boolean): void {
    if (enabled) {
      this.editor.setTool('drawing');
    } else {
      this.editor.setTool('select');
    }
  }
}

// 使用插件
const watermarkPlugin = new WatermarkPlugin();
const drawingPlugin = new DrawingPlugin();

editor.plugins.use(watermarkPlugin);
editor.plugins.use(drawingPlugin);

// 配置插件
watermarkPlugin.setText('© 2024 My Company');
drawingPlugin.setStrokeColor('#FF0000');
drawingPlugin.setLineWidth(3);
```

### 钩子系统

```typescript
// 注册前置钩子（可阻止默认行为）
editor.hooks.before('mouse:down', (worldPoint, event) => {
  console.log('鼠标按下前处理:', worldPoint);
  // 返回 false 可以阻止后续执行
  if (someCondition) {
    return false;
  }
});

// 注册后置钩子
editor.hooks.after('object:drag:end', (event) => {
  console.log('拖拽结束后处理');
  // 可以在这里触发历史记录
  editor.hooks.trigger('history:capture', 'Object moved');
});

// 渲染相关钩子
editor.hooks.before('render:before', (ctx) => {
  // 在主渲染之前执行（如绘制背景）
  console.log('开始渲染前的准备');
});

editor.hooks.after('render:after', (ctx) => {
  // 在主渲染之后执行（如绘制覆盖层）
  console.log('渲染完成后的处理');
});

// 历史记录钩子
editor.hooks.after('history:capture', (description) => {
  console.log('捕获历史状态:', description);
});

// 对象生命周期钩子
editor.hooks.before('object:before-add', (object) => {
  console.log('对象添加前:', object);
});

editor.hooks.after('object:after-add', (object) => {
  console.log('对象添加后:', object);
});

// 自定义钩子触发
editor.hooks.trigger('custom:hook', { customData: 'value' });
```

## 🎮 操作说明

### 鼠标操作
- **缩放**: 鼠标滚轮缩放画布，以鼠标位置为中心
- **平移**: 按住 Shift + 左键拖拽 或 中键拖拽
- **空格平移**: 按住空格键 + 左键拖拽画布
- **选择**: 点击图像进行选择
- **移动**: 拖拽选中的图像
- **缩放对象**: 拖拽选择框的角点控制点（等比缩放）
- **拉伸对象**: 拖拽选择框的边缘中点控制点（单向拉伸）
- **旋转**: 拖拽旋转控制点（圆形图标）

### 颜色选择工具
- **激活**: 选择颜色选择插件后，点击图像开始选择
- **圆形选择**: 按住鼠标左键拖拽创建圆形选择区域
- **实时预览**: 拖拽过程中可实时预览选择效果
- **容差调整**: 通过插件API调整颜色容差值

### 遮罩笔刷工具
- **笔刷绘制**: 在图像上按住左键拖拽进行涂抹
- **添加模式**: 涂抹添加遮罩区域
- **删除模式**: 涂抹移除遮罩区域
- **笔刷大小**: 通过API动态调整笔刷大小

### 键盘快捷键
- **Delete/Backspace**: 删除选中对象
- **Ctrl+Z**: 撤销操作
- **Ctrl+Shift+Z / Ctrl+Y**: 重做操作
- **Ctrl+A**: 全选（选择第一个对象）
- **Ctrl+C**: 复制选中对象
- **Ctrl+V**: 粘贴对象
- **Escape**: 取消选择
- **Space**: 按住空格键启用平移模式

## 🔧 API 文档

### Editor 类

#### 构造函数
```typescript
new Editor(options: EditorOptions)
```

#### 主要方法

**对象管理**
- `addObject(object: BaseObject, layerId?: string, needRecord?: boolean)` - 添加对象
- `removeObject(object: BaseObject)` - 移除对象
- `selectObject(object: BaseObject)` - 选择对象
- `clearSelection()` - 清除选择
- `getSelectedObject(): BaseObject | null` - 获取选中对象
- `selectAll()` - 选择所有对象
- `deleteSelected()` - 删除选中对象

**图像操作**
- `addImage({ src, x?, y?, needRecord? })` - 添加图像，返回Promise
- `importByJson(data: Array)` - 批量导入图像数据
- `toDataURL(type?: string, quality?: number)` - 导出图像

**视口控制**
- `zoomIn() / zoomOut()` - 缩放操作
- `zoomToFit()` - 适应画布
- `resetZoom()` - 重置缩放
- `enableSpacePan() / disableSpacePan()` - 启用/禁用空格平移
- `isSpacePanEnabled(): boolean` - 检查空格平移状态

**历史记录**
- `undo() / redo()` - 撤销/重做
- `enableHistory() / disableHistory()` - 启用/禁用历史记录
- `isHistoryEnabled(): boolean` - 检查历史记录状态

**状态管理**
- `getState(): any` - 获取编辑器状态
- `setState(state: any)` - 设置编辑器状态
- `suspendRendering() / resumeRendering()` - 暂停/恢复渲染

**工具切换**
- `setTool(tool: string)` - 设置当前工具
- `getCurrentTool(): string` - 获取当前工具

**其他**
- `getCanvas(): HTMLCanvasElement` - 获取画布元素
- `getContext(): CanvasRenderingContext2D` - 获取画布上下文
- `isReady(): boolean` - 检查是否已初始化
- `destroy()` - 销毁编辑器

### BaseObject 类

#### 主要属性
- `id: string` - 唯一标识
- `type: string` - 对象类型
- `transform: Transform` - 变换信息（位置、缩放、旋转）
- `visible: boolean` - 是否可见
- `selectable: boolean` - 是否可选择
- `width: number` - 对象宽度
- `height: number` - 对象高度
- `fill: string` - 填充颜色
- `stroke: string` - 描边颜色
- `strokeWidth: number` - 描边宽度
- `opacity: number` - 透明度

#### 主要方法

**变换操作**
- `move(deltaX: number, deltaY: number)` - 相对移动
- `setPosition(x: number, y: number)` - 设置绝对位置
- `scale(scaleX: number, scaleY?: number)` - 相对缩放
- `setScale(scaleX: number, scaleY?: number)` - 设置绝对缩放
- `rotate(angle: number)` - 相对旋转
- `setRotation(angle: number)` - 设置绝对旋转
- `setSize(width: number, height: number)` - 设置尺寸

**几何计算**
- `hitTest(point: Point): boolean` - 碰撞检测
- `getBounds(): Bounds` - 获取包围盒
- `getOBB(): OBB` - 获取有向包围盒
- `getCenter(): Point` - 获取中心点
- `setCenter(point: Point)` - 设置中心点
- `intersectsWith(other: BaseObject): boolean` - 检测与其他对象相交

**其他**
- `render(ctx: CanvasRenderingContext2D)` - 渲染方法（抽象）
- `clone(): BaseObject` - 克隆对象
- `toJSON(): any` - 序列化为JSON
- `destroy()` - 销毁对象（抽象）

### ImageObject 类

继承自 BaseObject，专门用于处理图像。

#### 特有属性
- `src: string` - 图像源路径
- `crossOrigin: string | null` - 跨域设置
- `filters: string[]` - CSS滤镜效果
- `hasMask: boolean` - 是否有遮罩
- `maskOpacity: number` - 遮罩透明度
- `maskColor: string` - 遮罩颜色

#### 特有方法

**图像控制**
- `setSrc(src: string)` - 设置图像源
- `getSrc(): string` - 获取图像源
- `isLoaded(): boolean` - 检查是否已加载
- `getImage(): HTMLImageElement` - 获取HTML图像元素

**滤镜管理**
- `addFilter(filter: string)` - 添加滤镜
- `removeFilter(filter: string)` - 移除滤镜
- `clearFilters()` - 清除所有滤镜
- `setFilters(filters: string[])` - 设置滤镜列表

**遮罩操作**
- `setMaskOpacity(opacity: number)` - 设置遮罩透明度
- `setMaskColor(color: string)` - 设置遮罩颜色
- `getMaskData(): ImageData | null` - 获取遮罩数据
- `setMaskData(imageData: ImageData)` - 设置遮罩数据
- `clearMask()` - 清除遮罩
- `hasMaskData(): boolean` - 检查是否有遮罩数据

**图像处理**
- `getImageData(ctx?: CanvasRenderingContext2D): ImageData | null` - 获取图像数据
- `setImageData(imageData: ImageData)` - 设置图像数据
- `crop(x: number, y: number, width: number, height: number)` - 裁剪图像

### 插件接口

```typescript
interface Plugin {
  name: string;
  version: string;
  install: (editor: Editor) => void;
  uninstall?: (editor: Editor) => void;
}
```

## 🚀 快速开始

1. **克隆项目**
```bash
git clone <repository-url>
cd image-editor
```

2. **安装依赖**
```bash
npm install
```

3. **启动开发服务器**
```bash
npm run dev
```

4. **访问演示**
打开浏览器访问 `http://localhost:5173`

## 🌟 示例功能

当前演示应用包含以下功能：

### 基础功能
- ✨ 完整的工具栏界面
- 🖼️ 图像上传和添加，支持批量导入
- 🎯 精确的对象选择和操作（OBB选择框）
- 📐 网格背景显示（普通网格/棋盘格模式）
- 📜 完整的撤销重做功能，支持自动状态捕获
- 🔍 缩放和平移操作，支持空格键平移
- 💾 图像导出功能，支持多种格式

### 高级功能
- 🎨 **智能颜色选择** - 魔棒工具，支持容差调整和实时预览
- 🖌️ **遮罩笔刷工具** - 支持添加/删除遮罩，笔刷大小调整
- ⚡ **Web Worker优化** - 颜色选择使用Worker提升性能
- 🎭 **图像遮罩系统** - 完整的遮罩功能，支持透明度调整
- 📱 **高DPI支持** - 完美支持Retina等高分辨率屏幕
- 🎮 **空格键平移** - 类似PhotoShop的空格键抓手工具

### 开发者功能
- 🔧 **插件系统** - 完整的插件架构，支持自定义功能扩展
- 🎯 **钩子机制** - 丰富的钩子点，可在关键时机插入自定义逻辑
- 📊 **状态管理** - 完整的状态序列化和恢复机制
- 🎪 **事件系统** - 丰富的事件类型，支持自定义事件监听
- 📋 **历史记录** - 支持自定义历史捕获策略和状态管理

## 🔮 扩展性

框架设计时充分考虑了扩展性：

1. **新对象类型** - 继承BaseObject创建新的渲染对象（如文本、形状等）
2. **自定义工具** - 通过插件系统添加新工具（如绘图、标注等）
3. **界面定制** - 事件系统支持自定义UI控制和交互逻辑
4. **渲染增强** - 钩子系统允许自定义渲染逻辑（如水印、特效等）
5. **数据格式** - 支持自定义序列化格式和导入导出
6. **性能优化** - Web Worker支持，可扩展更多计算密集型功能
7. **遮罩系统** - 完整的遮罩API，支持复杂的图像处理需求
8. **历史系统** - 可扩展的历史记录机制，支持自定义状态管理策略

### 典型扩展场景

- **文本编辑器** - 添加TextObject类和文本编辑插件
- **矢量绘图** - 添加Path、Rectangle、Circle等形状对象
- **图像滤镜** - 通过插件系统添加各种图像处理滤镜
- **协作编辑** - 通过事件系统和状态管理实现多用户协作
- **AI功能** - 集成AI API，实现智能抠图、内容识别等功能

## 📝 技术栈

- **TypeScript** - 类型安全的开发体验
- **Canvas API** - 高性能的图形渲染
- **Vue 3** - 现代化的UI框架
- **Vite** - 快速的构建工具

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个框架！

## 📄 许可证

MIT License