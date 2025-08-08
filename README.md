# Canvas 图像编辑器框架

一个基于原生Canvas实现的模块化图像编辑器框架，参考Fabric.js的设计理念，提供完整的图像编辑功能。

## 🚀 特性

### 核心功能
- ✅ **画布缩放和移动** - 支持鼠标滚轮缩放、拖拽平移
- ✅ **OBB选择框** - 基于有向包围盒的精确选择，支持缩放、移动、旋转
- ✅ **模块化设计** - 清晰的模块划分，易于扩展和维护
- ✅ **插件系统** - 完整的插件架构，支持钩子机制
- ✅ **事件系统** - 完善的事件发射器，支持自定义事件
- ✅ **对象管理** - 支持图层管理、z-index排序、批量操作

### 交互功能
- 🖱️ **鼠标操作** - 完整的鼠标事件处理
- ⌨️ **键盘快捷键** - 删除、撤销、重做等快捷键
- 🎯 **精确选择** - 基于数学计算的精确hit-test
- 🔄 **实时预览** - 高性能的实时渲染系统

### 内置插件
- 📐 **网格插件** - 可配置的网格背景
- 📜 **历史插件** - 撤销重做功能，支持历史记录管理

## 🏗️ 框架架构

### 核心模块

```
src/editor/
├── types.ts                 # 类型定义
├── index.ts                 # 入口文件
├── Editor.ts                # 主编辑器类
├── core/                    # 核心模块
│   ├── EventEmitter.ts      # 事件发射器
│   ├── HookManager.ts       # 钩子管理器
│   ├── PluginManager.ts     # 插件管理器
│   ├── Viewport.ts          # 视口管理器
│   └── ObjectManager.ts     # 对象管理器
├── objects/                 # 渲染对象
│   ├── BaseObject.ts        # 基础对象类
│   └── ImageObject.ts       # 图像对象类
├── controls/                # 控制器
│   └── SelectionBox.ts      # 选择框控制器
├── utils/                   # 工具类
│   └── math.ts              # 数学工具函数
└── plugins/                 # 内置插件
    ├── GridPlugin.ts        # 网格插件
    └── HistoryPlugin.ts     # 历史记录插件
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
import { Editor, GridPlugin, HistoryPlugin } from './editor';

// 创建编辑器实例
const editor = new Editor({
  container: '#editor-container',
  width: 800,
  height: 600,
  backgroundColor: '#F5F5F5',
  plugins: [
    new GridPlugin({ size: 20, color: '#E0E0E0' }),
    new HistoryPlugin({ maxHistorySize: 50 })
  ]
});

// 添加图像
editor.addImage('path/to/image.jpg', 100, 100)
  .then(imageObject => {
    console.log('图像添加成功:', imageObject);
  });
```

### 事件监听

```typescript
// 监听选择变化
editor.on('selection:changed', (event) => {
  console.log('选择的对象:', event.newTarget);
});

// 监听对象变化
editor.on('object:moved', (event) => {
  console.log('对象移动:', event.object);
});

// 监听视口变化
editor.on('viewport:zoom', (event) => {
  console.log('缩放级别:', event.zoom);
});
```

### 插件开发

```typescript
import { Plugin } from './editor';

class CustomPlugin implements Plugin {
  name = 'custom';
  version = '1.0.0';
  
  install(editor: Editor): void {
    // 注册钩子
    editor.hooks.before('render:before', this.beforeRender.bind(this));
    
    // 添加自定义方法
    (editor as any).customMethod = () => {
      console.log('自定义功能');
    };
  }
  
  uninstall(editor: Editor): void {
    // 清理逻辑
    editor.hooks.removeHook('render:before', this.beforeRender);
    delete (editor as any).customMethod;
  }
  
  private beforeRender(ctx: CanvasRenderingContext2D): void {
    // 自定义渲染逻辑
  }
}

// 使用插件
editor.plugins.use(new CustomPlugin());
```

### 钩子系统

```typescript
// 注册前置钩子
editor.hooks.before('object:drag:start', (event) => {
  console.log('开始拖拽前的处理');
  // 返回 false 可以阻止后续执行
});

// 注册后置钩子
editor.hooks.after('object:drag:end', (event) => {
  console.log('拖拽结束后的处理');
});

// 自定义钩子
editor.hooks.trigger('custom:hook', data);
```

## 🎮 操作说明

### 鼠标操作
- **缩放**: 鼠标滚轮缩放画布
- **平移**: 按住 Shift + 左键拖拽 或 中键拖拽
- **选择**: 点击图像进行选择
- **移动**: 拖拽选中的图像
- **缩放**: 拖拽选择框的角点控制点
- **旋转**: 拖拽旋转控制点

### 键盘快捷键
- **Delete/Backspace**: 删除选中对象
- **Ctrl+Z**: 撤销
- **Ctrl+Shift+Z**: 重做
- **Ctrl+A**: 全选
- **Ctrl+C**: 复制
- **Ctrl+V**: 粘贴
- **Escape**: 取消选择

## 🔧 API 文档

### Editor 类

#### 构造函数
```typescript
new Editor(options: EditorOptions)
```

#### 主要方法
- `addObject(object: BaseObject, layerId?: string)` - 添加对象
- `removeObject(object: BaseObject)` - 移除对象
- `selectObject(object: BaseObject)` - 选择对象
- `clearSelection()` - 清除选择
- `addImage(src: string, x?: number, y?: number)` - 添加图像
- `zoomIn() / zoomOut()` - 缩放操作
- `zoomToFit()` - 适应画布
- `toDataURL()` - 导出图像

### BaseObject 类

#### 主要属性
- `id: string` - 唯一标识
- `type: string` - 对象类型
- `transform: Transform` - 变换信息
- `visible: boolean` - 是否可见
- `selectable: boolean` - 是否可选择

#### 主要方法
- `render(ctx: CanvasRenderingContext2D)` - 渲染方法
- `move(deltaX: number, deltaY: number)` - 移动
- `scale(scaleX: number, scaleY: number)` - 缩放
- `rotate(angle: number)` - 旋转
- `hitTest(point: Point)` - 碰撞检测

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

- ✨ 完整的工具栏界面
- 🖼️ 图像上传和添加
- 🎯 精确的对象选择和操作
- 📐 网格背景显示
- 📜 撤销重做功能
- 🔍 缩放和平移操作
- 💾 图像导出功能

## 🔮 扩展性

框架设计时充分考虑了扩展性：

1. **新对象类型** - 继承BaseObject创建新的渲染对象
2. **自定义工具** - 通过插件系统添加新工具
3. **界面定制** - 事件系统支持自定义UI控制
4. **渲染增强** - 钩子系统允许自定义渲染逻辑
5. **数据格式** - 支持自定义序列化格式

## 📝 技术栈

- **TypeScript** - 类型安全的开发体验
- **Canvas API** - 高性能的图形渲染
- **Vue 3** - 现代化的UI框架
- **Vite** - 快速的构建工具

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个框架！

## 📄 许可证

MIT License