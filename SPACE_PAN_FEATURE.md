# 空格键移动画布功能

## 功能概述

空格键移动画布功能允许用户通过按住空格键并拖拽鼠标来移动画布，这是一种常见的图像编辑软件交互方式。

## 功能特性

- ✅ **配置项控制**: 通过 `enableSpacePan` 配置项启用/禁用功能
- ✅ **视觉反馈**: 按住空格键时鼠标光标变为抓取状态
- ✅ **实时拖拽**: 拖拽时实时移动画布，提供流畅的用户体验
- ✅ **事件系统**: 支持完整的事件监听和状态查询
- ✅ **兼容性**: 与其他移动方式（Shift+拖拽、中键拖拽）完全兼容
- ✅ **状态管理**: 提供完整的状态查询和控制方法

## 使用方法

### 1. 创建编辑器时启用功能

```typescript
import { Editor } from './editor';

const editor = new Editor({
  container: document.getElementById('editor'),
  width: 800,
  height: 600,
  enableSpacePan: true, // 启用空格键移动画布功能
  // ... 其他配置
});
```

### 2. 运行时控制功能

```typescript
// 启用空格键移动画布功能
editor.enableSpacePan();

// 禁用空格键移动画布功能
editor.disableSpacePan();

// 检查功能是否启用
const isEnabled = editor.isSpacePanEnabled();

// 检查空格键是否当前被按下
const isPressed = editor.getSpacePressed();
```

### 3. 事件监听

```typescript
// 监听空格键按下事件
editor.on('space:down', (event) => {
  console.log('空格键按下，可以开始拖拽移动画布');
});

// 监听空格键抬起事件
editor.on('space:up', (event) => {
  console.log('空格键抬起，停止拖拽模式');
});

// 监听拖拽开始事件
editor.on('pan:start', (event) => {
  console.log('开始拖拽画布', event.point);
});

// 监听拖拽移动事件
editor.on('pan:move', (event) => {
  console.log('拖拽画布中', event.deltaX, event.deltaY);
});

// 监听拖拽结束事件
editor.on('pan:end', (event) => {
  console.log('结束拖拽画布');
});

// 监听功能启用/禁用事件
editor.on('space-pan:enabled', () => {
  console.log('空格键移动画布功能已启用');
});

editor.on('space-pan:disabled', () => {
  console.log('空格键移动画布功能已禁用');
});
```

## 操作方式

1. **启用功能**: 确保 `enableSpacePan` 配置项为 `true`
2. **按住空格键**: 在画布上按住空格键
3. **拖拽移动**: 按住左键拖拽鼠标移动画布
4. **释放按键**: 释放空格键或鼠标按键停止移动

## 技术实现

### 核心组件

- **Editor.ts**: 主编辑器类，包含空格键移动画布的核心逻辑
- **Viewport.ts**: 视口管理器，处理画布变换和平移
- **EventEmitter**: 事件系统，提供完整的事件支持

### 关键方法

```typescript
// 键盘事件处理
private handleKeyDown(event: KeyboardEvent): void
private handleKeyUp(event: KeyboardEvent): void

// 鼠标事件处理
private handleMouseDown(event: MouseEvent): void
private handleMouseMove(event: MouseEvent): void
private handleMouseUp(event: MouseEvent): void

// 公共控制方法
enableSpacePan(): void
disableSpacePan(): void
isSpacePanEnabled(): boolean
getSpacePressed(): boolean
```

### 状态管理

- `isSpacePressed`: 空格键是否被按下
- `isPanning`: 是否正在拖拽移动画布
- `lastPanPoint`: 上一次拖拽位置
- `enableSpacePan`: 功能启用状态

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableSpacePan` | `boolean` | `true` | 是否启用空格键移动画布功能 |

## 兼容性

- ✅ 与现有的 Shift+拖拽 移动方式兼容
- ✅ 与鼠标中键拖拽移动方式兼容
- ✅ 与滚轮缩放功能兼容
- ✅ 与对象选择和操作功能兼容

## 示例代码

### Vue 3 组件示例

```vue
<template>
  <div class="editor-app">
    <div class="toolbar">
      <button 
        :class="{ active: spacePanEnabled }" 
        @click="toggleSpacePan"
      >
        {{ spacePanEnabled ? '禁用' : '启用' }}空格移动
      </button>
    </div>
    
    <div ref="editorContainer" class="editor-canvas"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Editor } from './editor';

const editorContainer = ref<HTMLElement>();
const spacePanEnabled = ref(true);
let editor: Editor | null = null;

onMounted(() => {
  if (editorContainer.value) {
    editor = new Editor({
      container: editorContainer.value,
      width: 800,
      height: 600,
      enableSpacePan: true,
    });

    // 监听空格键事件
    editor.on('space:down', () => {
      console.log('空格键按下');
    });

    editor.on('pan:start', () => {
      console.log('开始拖拽画布');
    });
  }
});

const toggleSpacePan = () => {
  if (editor) {
    if (spacePanEnabled.value) {
      editor.disableSpacePan();
      spacePanEnabled.value = false;
    } else {
      editor.enableSpacePan();
      spacePanEnabled.value = true;
    }
  }
};
</script>
```

## 注意事项

1. **焦点管理**: 画布需要获得焦点才能接收键盘事件
2. **事件冲突**: 空格键事件会阻止默认行为（如页面滚动）
3. **状态同步**: 确保UI状态与实际功能状态保持同步
4. **性能优化**: 拖拽事件已进行节流处理，确保流畅性

## 更新日志

- **v1.0.0**: 初始实现空格键移动画布功能
  - 添加配置项 `enableSpacePan`
  - 实现完整的键盘和鼠标事件处理
  - 添加事件系统和状态管理
  - 提供公共控制方法 