# 颜色选区插件坐标和性能修复

## 修复问题

### 1. 坐标转换精度问题 ✅
**问题描述**：画布缩放时选区和鼠标位置不一致

**原因分析**：
- 错误地在插件中重复应用了 devicePixelRatio 缩放
- 编辑器的 canvas context 已经处理了 DPR 缩放
- 插件应该直接使用 CSS 坐标，而不是再次乘以 DPR

**解决方案**：
```typescript
// 修复前（错误）
const canvasPoint = {
  x: (event.clientX - rect.left) * devicePixelRatio,
  y: (event.clientY - rect.top) * devicePixelRatio
};

// 修复后（正确）
const canvasPoint = {
  x: event.clientX - rect.left,
  y: event.clientY - rect.top
};
```

### 2. 实时选择卡顿问题 ✅
**问题描述**：鼠标移动时执行洪水算法导致严重卡顿

**原因分析**：
- 洪水算法是计算密集型操作
- 在 mousemove 事件中频繁执行造成性能瓶颈
- 即使有节流机制，仍然影响用户体验

**解决方案**：
1. **移除实时洪水算法**：只在鼠标抬起时执行一次
2. **添加渲染节流**：限制重渲染频率为 60fps
3. **保留圆形预览**：用户仍能看到选区范围

```typescript
// 修复前：实时执行洪水算法
if (shouldPerformSelection) {
  this.performColorSelection(); // 造成卡顿
}

// 修复后：只在mouse up时执行
// onMouseMove: 只更新圆形预览
// onMouseUp: 执行一次洪水算法
```

## 技术细节

### 坐标系统理解
编辑器使用多层坐标系统：
1. **屏幕坐标**：鼠标事件坐标 (CSS 像素)
2. **Canvas坐标**：考虑DPR的实际像素坐标
3. **世界坐标**：考虑视口平移/缩放的逻辑坐标
4. **对象本地坐标**：相对于对象中心的坐标

### 性能优化策略
1. **算法延迟执行**：耗时操作延迟到用户操作完成
2. **渲染节流**：限制重绘频率，保持流畅体验
3. **状态管理**：准确追踪选择状态，避免无效计算

## 调试功能

启用 debug 模式可以看到：
- 起始点和当前点的世界坐标
- 选区半径和视口缩放
- 视口坐标转换后的屏幕坐标
- 可视化的中心点标记

```typescript
new ColorSelectionPlugin({
  debug: true // 显示坐标调试信息
})
```

## 验证方法

1. **坐标准确性测试**：
   - 在不同缩放级别下测试选区位置
   - 观察调试信息中的坐标转换
   - 确认圆形中心与鼠标点击位置一致

2. **性能测试**：
   - 快速拖动鼠标，观察是否卡顿
   - 检查 CPU 使用率
   - 确认60fps的流畅体验

## 兼容性说明

修复后的坐标转换与编辑器其他组件保持一致：
- SelectionBox 控制器
- MaskBrush 插件  
- 其他鼠标交互功能

性能优化不影响功能完整性，用户仍能获得完整的颜色选择体验。