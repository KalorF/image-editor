# 颜色选区插件使用文档

## 功能概述

颜色选区插件提供了一个强大的颜色选择工具，允许用户通过圆形选区和洪水算法来选择图像中的相似颜色区域。

## 主要功能

### 1. 圆形选区绘制
- 按下鼠标左键并拖动，可以绘制一个圆形选区
- 选区中心点为鼠标按下的位置
- 选区半径由拖动距离决定

### 2. 洪水算法颜色选择
- 在圆形选区内采样多个种子点
- 使用洪水算法扩展选择相似颜色的像素
- 支持颜色容差调节

### 3. 可视化选区蒙版
- 生成半透明的颜色蒙版显示选中区域
- 支持自定义选区颜色和透明度

## 使用方法

### 基本操作
1. 点击工具栏中的"颜色选区"按钮激活工具
2. 在图像上按下鼠标左键并拖动，绘制圆形选区
3. 松开鼠标完成颜色选择
4. 选中的颜色区域将以半透明蒙版显示

### 参数配置
- **容差值 (tolerance)**: 控制颜色相似度判断，范围 0-255，默认值 32
- **选区颜色 (selectionColor)**: 选区蒙版的显示颜色，默认绿色 #00FF00
- **选区透明度 (selectionOpacity)**: 选区蒙版的透明度，范围 0-1，默认 0.3

## API 接口

### 插件配置选项
```typescript
interface ColorSelectionPluginOptions {
  enabled?: boolean;          // 是否启用插件
  tolerance?: number;         // 颜色容差值 (0-255)
  selectionColor?: string;    // 选区显示颜色
  selectionOpacity?: number;  // 选区透明度 (0-1)
}
```

### 编辑器接口
通过编辑器实例访问插件功能：
```typescript
// 启用/禁用插件
editor.colorSelection.enable();
editor.colorSelection.disable();

// 设置参数
editor.colorSelection.setTolerance(50);
editor.colorSelection.setSelectionColor('#FF0000');
editor.colorSelection.setSelectionOpacity(0.5);

// 清除选区
editor.colorSelection.clearSelection();

// 获取选区蒙版数据
const mask = editor.colorSelection.getSelectionMask();
```

## 插件集成

### 1. 安装插件
```typescript
import { Editor, ColorSelectionPlugin } from './editor';

const editor = new Editor({
  container: document.getElementById('canvas'),
  plugins: [
    new ColorSelectionPlugin({
      tolerance: 32,
      selectionColor: '#00FF00',
      selectionOpacity: 0.3
    })
  ]
});
```

### 2. 工具切换
```typescript
// 切换到颜色选区工具
editor.setTool('colorSelection');

// 切换回选择工具
editor.setTool('select');
```

## 事件监听

插件支持以下事件：
- `colorSelection:enabled` - 插件启用时触发
- `colorSelection:disabled` - 插件禁用时触发
- `colorSelection:completed` - 颜色选择完成时触发
- `colorSelection:cleared` - 选区清除时触发
- `colorSelection:tolerance-changed` - 容差值改变时触发
- `colorSelection:color-changed` - 选区颜色改变时触发
- `colorSelection:opacity-changed` - 选区透明度改变时触发

## 技术实现

### 算法原理
1. **圆形选区检测**: 使用欧几里得距离判断像素是否在圆形区域内
2. **种子点采样**: 在圆形区域内按网格采样多个种子点
3. **洪水算法**: 广度优先搜索扩展相似颜色像素
4. **颜色相似度**: 使用 RGB 颜色空间的欧几里得距离

### 坐标转换
插件支持完整的坐标系转换：
- 屏幕坐标 ↔ 世界坐标
- 世界坐标 ↔ 图像本地坐标
- 考虑图像的平移、缩放、旋转变换

### 性能优化
- 使用 Uint8Array 存储蒙版数据，节省内存
- 采样策略优化，避免重复计算
- 使用高效的广度优先搜索算法

## 注意事项

1. 插件仅对 ImageObject 类型的对象有效
2. 需要图像完全加载后才能使用
3. 大图像或高容差值可能导致处理时间较长
4. 选区蒙版会覆盖在原图像上显示

## 浏览器兼容性

- 现代浏览器（Chrome 60+、Firefox 55+、Safari 11+）
- 需要支持 Canvas 2D API
- 需要支持 ES6+ 语法

## 示例代码

完整的使用示例请参考 `src/App.vue` 和 `src/components/ComparisonView.vue` 文件。