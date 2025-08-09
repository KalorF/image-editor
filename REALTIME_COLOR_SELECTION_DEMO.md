# 实时颜色选择功能演示

## 功能概述

ColorSelectionPlugin现已支持实时拖动选取功能，在保证性能的同时提供流畅的用户体验。

## 新增功能

### 1. 实时选择模式
- **默认启用**：插件默认开启实时选择模式
- **智能优化**：自动根据选区大小调整处理策略
- **性能保障**：通过多种优化技术确保流畅体验

### 2. 性能优化技术

#### 缓存机制
- 图像数据缓存，避免重复获取
- 智能缓存管理，防止内存泄漏

#### 节流控制
- 默认100ms节流间隔
- 可配置的节流时间（50-500ms）
- 避免过于频繁的计算

#### 算法优化
- 限制种子点数量（最多50个）
- 限制搜索区域到圆形附近
- 限制处理点数量（最多10000个）
- 队列大小限制（最多5000个）

#### 异步处理
- 使用requestIdleCallback优化
- 非阻塞UI更新

## 使用方法

### 基本配置
```javascript
// 创建插件实例，配置实时选择参数
const colorSelectionPlugin = new ColorSelectionPlugin({
  realTimeSelection: true,        // 启用实时选择（默认true）
  realTimeThrottleMs: 100,       // 节流时间100ms（默认）
  maxRealTimeRadius: 200,        // 最大实时选择半径200px（默认）
  tolerance: 32,                 // 颜色容差
  selectionColor: '#00FF00',     // 选区颜色
  selectionOpacity: 0.3          // 选区透明度
});

// 安装插件
editor.addPlugin(colorSelectionPlugin);
```

### 运行时配置
```javascript
// 启用/禁用实时选择
editor.colorSelection.setRealTimeSelection(true);

// 调整节流时间（50-500ms）
editor.colorSelection.setRealTimeThrottle(150);

// 设置最大实时选择半径
editor.colorSelection.setMaxRealTimeRadius(300);

// 清理缓存（释放内存）
editor.colorSelection.clearCache();
```

### 获取配置状态
```javascript
// 检查实时选择是否启用
const isRealTimeEnabled = editor.colorSelection.isRealTimeEnabled();

// 获取当前节流时间
const throttle = editor.colorSelection.getRealTimeThrottle();

// 获取最大实时选择半径
const maxRadius = editor.colorSelection.getMaxRealTimeRadius();
```

## 性能参数建议

### 不同设备配置

#### 高性能设备
```javascript
{
  realTimeSelection: true,
  realTimeThrottleMs: 50,      // 更快的响应
  maxRealTimeRadius: 300,      // 更大的选择范围
  tolerance: 32
}
```

#### 中等性能设备
```javascript
{
  realTimeSelection: true,
  realTimeThrottleMs: 100,     // 默认配置
  maxRealTimeRadius: 200,
  tolerance: 32
}
```

#### 低性能设备
```javascript
{
  realTimeSelection: true,
  realTimeThrottleMs: 200,     // 更慢的响应，但更稳定
  maxRealTimeRadius: 150,      // 较小的选择范围
  tolerance: 32
}
```

#### 移动设备
```javascript
{
  realTimeSelection: false,    // 禁用实时选择，仅在鼠标抬起时执行
  realTimeThrottleMs: 300,
  maxRealTimeRadius: 100,
  tolerance: 32
}
```

## 事件监听

### 新增事件
```javascript
// 实时选择模式变化
editor.on('colorSelection:realtime-changed', (data) => {
  console.log('实时选择模式:', data.enabled);
});

// 节流时间变化
editor.on('colorSelection:throttle-changed', (data) => {
  console.log('节流时间:', data.throttle + 'ms');
});

// 最大半径变化
editor.on('colorSelection:max-radius-changed', (data) => {
  console.log('最大半径:', data.maxRadius + 'px');
});

// 缓存清理
editor.on('colorSelection:cache-cleared', () => {
  console.log('缓存已清理');
});
```

## 性能监控

### 检查性能指标
```javascript
// 监控选择操作的性能
let startTime = 0;

editor.on('colorSelection:started', () => {
  startTime = performance.now();
});

editor.on('colorSelection:completed', () => {
  const duration = performance.now() - startTime;
  console.log(`颜色选择耗时: ${duration.toFixed(2)}ms`);
  
  // 如果耗时过长，可以调整参数
  if (duration > 200) {
    console.warn('选择耗时过长，建议增加节流时间或减小最大半径');
    editor.colorSelection.setRealTimeThrottle(150);
    editor.colorSelection.setMaxRealTimeRadius(150);
  }
});
```

## 最佳实践

1. **根据硬件调整参数**：在低性能设备上适当降低实时性能要求
2. **监控内存使用**：定期调用`clearCache()`清理缓存
3. **合理设置半径限制**：过大的选择区域会影响性能
4. **动态调整节流时间**：根据实际性能动态调整
5. **提供用户控制**：允许用户在界面中开启/关闭实时选择

## 故障排除

### 性能问题
- 增加节流时间：`setRealTimeThrottle(200)`
- 减小最大半径：`setMaxRealTimeRadius(150)`
- 禁用实时选择：`setRealTimeSelection(false)`

### 内存问题
- 定期清理缓存：`clearCache()`
- 减小最大半径限制
- 降低容差值减少选择区域

### 兼容性问题
- 检查是否支持requestIdleCallback
- 在旧设备上禁用实时选择
- 使用setTimeout作为fallback