<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount } from 'vue';
import { Editor, GridPlugin, HistoryPlugin, MaskBrushPlugin } from './editor';

const editorContainer = ref<HTMLElement>();
let editor: Editor | null = null;

// 控制面板状态
const selectedTool = ref('select');
const zoomLevel = ref(100);
const canUndo = ref(false);
const canRedo = ref(false);
const gridEnabled = ref(true);
const spacePanEnabled = ref(true);

// Mask Brush 相关状态
const maskBrushEnabled = ref(false);
const maskBrushSize = ref(20);
const maskBrushMode = ref<'add' | 'remove'>('add');
const maskBrushOpacity = ref(0.4);
const maskBrushColor = ref('#2661f1');

// DPR 调试信息
const devicePixelRatio = ref(window.devicePixelRatio || 1);

// 获取控制点大小信息用于调试
const getControlPointInfo = () => {
  if (!editor || !editor.selectionBox) return null;
  const viewport = editor.viewport;
  const zoom = viewport.zoom;
  const baseSize = 8; // 默认控制点大小
  const adjustedSize = baseSize / zoom;
  return {
    zoom: zoom.toFixed(2),
    baseSize,
    adjustedSize: adjustedSize.toFixed(2)
  };
};

// 文件输入
const fileInput = ref<HTMLInputElement>();

onMounted(() => {
  if (editorContainer.value) {
    // 创建编辑器实例
    editor = new Editor({
      container: editorContainer.value,
      width: 800,
      height: 600,
      enableSpacePan: true, // 启用空格键移动画布功能
      plugins: [
        new GridPlugin({ size: 8, checkerboard: true, showShadow: false }),
        new HistoryPlugin({ maxHistorySize: 20 }),
        new MaskBrushPlugin({ 
          brushSize: maskBrushSize.value,
          mode: maskBrushMode.value,
          opacity: maskBrushOpacity.value,
          color: maskBrushColor.value
        })
      ]
    });

    // 监听编辑器事件
    editor.on('editor:initialized', () => {
      console.log('编辑器初始化完成');
    });

    editor.on('selection:changed', (event) => {
      console.log('选择变化:', event);
    });

    editor.on('viewport:zoom', (event) => {
      zoomLevel.value = Math.round(editor!.viewport.zoom * 100);
    });

    // 监听历史记录变化
    editor.on('history:state-captured', (event) => {
      canUndo.value = (editor as any).history.canUndo();
      canRedo.value = (editor as any).history.canRedo();
    });

    editor.on('history:undo', () => {
      canUndo.value = (editor as any).history.canUndo();
      canRedo.value = (editor as any).history.canRedo();
    });

    editor.on('history:redo', () => {
      canUndo.value = (editor as any).history.canUndo();
      canRedo.value = (editor as any).history.canRedo();
    });

    // 监听空格键移动画布事件
    editor.on('space:down', () => {
      console.log('空格键按下 - 可以拖拽移动画布');
    });

    editor.on('space:up', () => {
      console.log('空格键抬起 - 停止拖拽模式');
    });

    editor.on('pan:start', () => {
      console.log('开始拖拽画布');
    });

    editor.on('pan:end', () => {
      console.log('结束拖拽画布');
    });

    // 监听mask brush事件
    editor.on('maskBrush:enabled', () => {
      maskBrushEnabled.value = true;
    });

    editor.on('maskBrush:disabled', () => {
      maskBrushEnabled.value = false;
    });

    editor.on('mask:changed', (event) => {
      console.log('Mask已变化:', event);
    });

    // 监听工具切换事件，管理笔刷光标
    editor.on('tool:changed', (event: any) => {
      if (editor && (editor as any).maskBrush) {
        const newTool = event.data?.newTool || event.newTool;
        if (newTool === 'maskBrush') {
          (editor as any).maskBrush.enable();
        } else {
          (editor as any).maskBrush.disable();
        }
      }
    });

    // 添加一些示例图像
    addSampleImages();
  }
});

onBeforeUnmount(() => {
  if (editor) {
    editor.destroy();
  }
});

// 添加示例图像
const addSampleImages = () => {
  console.log('添加示例图像', editor);
  if (!editor) return;

  // 创建一个彩色矩形作为示例
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 150;
  const ctx = canvas.getContext('2d')!;
  
  // 渐变背景
  const gradient = ctx.createLinearGradient(0, 0, 200, 150);
  gradient.addColorStop(0, '#FF6B6B');
  gradient.addColorStop(1, '#4ECDC4');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 200, 150);
  
  // 添加文字
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('示例图像', 100, 80);

  const dataURL = canvas.toDataURL();
  
  editor.addImage(dataURL, 100, 100).then((imageObj) => {
    console.log('示例图像添加成功:', imageObj);
  });
};

// 工具栏功能
const setTool = (tool: string) => {
  selectedTool.value = tool;
  if (editor) {
    editor.setTool(tool);
  }
};

const zoomIn = () => {
  if (editor) {
    editor.zoomIn();
  }
};

const zoomOut = () => {
  if (editor) {
    editor.zoomOut();
  }
};

const zoomToFit = () => {
  if (editor) {
    editor.zoomToFit();
  }
};

const resetZoom = () => {
  if (editor) {
    editor.resetZoom();
  }
};

const undo = () => {
  if (editor && (editor as any).history) {
    (editor as any).history.undo();
  }
};

const redo = () => {
  if (editor && (editor as any).history) {
    (editor as any).history.redo();
  }
};

const toggleGrid = () => {
  if (editor && (editor as any).grid) {
    if (gridEnabled.value) {
      (editor as any).grid.hide();
    } else {
      (editor as any).grid.show();
    }
    gridEnabled.value = !gridEnabled.value;
  }
};

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

const deleteSelected = () => {
  if (editor) {
    editor.deleteSelected();
  }
};

// 文件上传
const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (file && editor) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataURL = e.target?.result as string;
      editor!.addImage(dataURL).then((imageObj) => {
        console.log('图像上传成功:', imageObj);
        editor!.selectObject(imageObj);
        // 文件处理完成后再清空输入框
        target.value = '';
      }).catch((error) => {
        console.error('图像上传失败:', error);
        alert('图像上传失败: ' + error.message);
        // 即使失败也要清空输入框
        target.value = '';
      });
    };
    reader.readAsDataURL(file);
  }
};

const uploadImage = () => {
  fileInput.value?.click();
};

const exportImage = () => {
  if (editor) {
    const dataURL = editor.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'exported-image.png';
    link.href = dataURL;
    link.click();
  }
};

// 测试函数：设置特定的缩放级别来测试控制点大小
const testZoomLevel = (level: number) => {
  if (editor) {
    editor.viewport.setZoom(level);
    console.log(`缩放级别: ${level}, 控制点信息:`, getControlPointInfo());
  }
};

// 强制重新渲染，用于测试清除效果
const forceRerender = () => {
  if (editor) {
    editor.requestRender();
    console.log('强制重新渲染完成');
  }
};

// 测试位置功能
const testPositioning = () => {
  if (!editor) return;
  
  // 创建测试图像
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  
  // 绘制红色方块
  ctx.fillStyle = '#FF0000';
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = 'white';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('测试', 50, 55);

  const dataURL = canvas.toDataURL();
  
  // 测试居中（不传坐标）
  editor.addImage(dataURL).then((imageObj) => {
    console.log('居中图像添加成功:', imageObj.transform);
  });
  };

// Mask Brush 相关功能
const toggleMaskBrush = () => {
  if (editor) {
    if (selectedTool.value === 'maskBrush') {
      setTool('select');
    } else {
      setTool('maskBrush');
    }
  }
};

const setBrushSize = (size: number) => {
  maskBrushSize.value = size;
  if (editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setBrushSize(size);
  }
};

const setBrushMode = (mode: 'add' | 'remove') => {
  maskBrushMode.value = mode;
  if (editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setMode(mode);
  }
};

const setBrushOpacity = (opacity: number) => {
  maskBrushOpacity.value = opacity;
  if (editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setOpacity(opacity);
  }
};

const setBrushColor = (color: string) => {
  maskBrushColor.value = color;
  if (editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setColor(color);
  }
};

const clearMask = () => {
  if (editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.clearMask();
  }
};

const testSpecificPosition = () => {
  if (!editor) return;
  
  // 创建测试图像
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  
  // 绘制蓝色方块
  ctx.fillStyle = '#0000FF';
  ctx.fillRect(0, 0, 80, 80);
  ctx.fillStyle = 'white';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('位置', 40, 45);

  const dataURL = canvas.toDataURL();
  
  // 测试特定位置 (100, 100)
  editor.addImage(dataURL, 100, 100).then((imageObj) => {
    console.log('指定位置图像添加成功:', imageObj.transform);
  });
};
</script>

<template>
  <div class="editor-app">
    <!-- 标题 -->
    <header class="header">
      <h1>Canvas 图像编辑器框架演示</h1>
      <p>支持画布缩放移动、OBB选择框、插件系统、撤销重做等功能</p>
    </header>

    <!-- 工具栏 -->
    <div class="toolbar">
      <!-- 工具选择 -->
      <div class="tool-group">
        <label>工具:</label>
        <button 
          :class="{ active: selectedTool === 'select' }"
          @click="setTool('select')"
        >
          选择
        </button>
        <button 
          :class="{ active: selectedTool === 'maskBrush' }"
          @click="toggleMaskBrush"
        >
          涂抹
        </button>
      </div>

      <!-- 缩放控制 -->
      <div class="tool-group">
        <label>缩放:</label>
        <button @click="zoomOut">缩小</button>
        <span class="zoom-level">{{ zoomLevel }}%</span>
        <button @click="zoomIn">放大</button>
        <button @click="resetZoom">重置</button>
        <button @click="zoomToFit">适应</button>
      </div>

      <!-- 历史记录 -->
      <div class="tool-group">
        <label>历史:</label>
        <button :disabled="!canUndo" @click="undo">撤销</button>
        <button :disabled="!canRedo" @click="redo">重做</button>
      </div>

      <!-- 视图选项 -->
      <div class="tool-group">
        <label>视图:</label>
        <button :class="{ active: gridEnabled }" @click="toggleGrid">
          网格
        </button>
        <button :class="{ active: spacePanEnabled }" @click="toggleSpacePan">
          空格移动
        </button>
      </div>

      <!-- Mask Brush 控制 -->
      <div class="tool-group" v-if="selectedTool === 'maskBrush'">
        <label>笔刷:</label>
        <label>大小:</label>
        <input 
          type="range" 
          min="5" 
          max="100" 
          v-model="maskBrushSize"
          @input="setBrushSize(Number(($event.target as HTMLInputElement).value))"
        />
        <span>{{ maskBrushSize }}px</span>
        
        <label>模式:</label>
        <button 
          :class="{ active: maskBrushMode === 'add' }"
          @click="setBrushMode('add')"
        >
          添加
        </button>
        <button 
          :class="{ active: maskBrushMode === 'remove' }"
          @click="setBrushMode('remove')"
        >
          去除
        </button>
        
        <label>透明度:</label>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.1"
          v-model="maskBrushOpacity"
          @input="setBrushOpacity(Number(($event.target as HTMLInputElement).value))"
        />
        <span>{{ Math.round(maskBrushOpacity * 100) }}%</span>
        
        <label>颜色:</label>
        <input 
          type="color" 
          v-model="maskBrushColor"
          @input="setBrushColor(($event.target as HTMLInputElement).value)"
        />
        
        <button @click="clearMask">清除蒙版</button>
      </div>

      <!-- DPR 信息 -->
      <div class="tool-group">
        <label>DPR:</label>
        <span class="dpr-info">{{ devicePixelRatio }}x</span>
      </div>

      <!-- 测试缩放 -->
      <div class="tool-group">
        <label>测试:</label>
        <button @click="testZoomLevel(0.25)">25%</button>
        <button @click="testZoomLevel(0.5)">50%</button>
        <button @click="testZoomLevel(1)">100%</button>
        <button @click="testZoomLevel(2)">200%</button>
      </div>

      <!-- 文件操作 -->
      <div class="tool-group">
        <label>文件:</label>
        <button @click="uploadImage">上传图像</button>
        <button @click="exportImage">导出图像</button>
        <button @click="deleteSelected">删除选中</button>
      </div>

      <!-- 调试工具 -->
      <div class="tool-group">
        <label>调试:</label>
        <button @click="forceRerender">强制重渲染</button>
        <button @click="testPositioning">测试居中</button>
        <button @click="testSpecificPosition">测试位置</button>
      </div>
    </div>

    <!-- 编辑器容器 -->
    <div class="editor-container">
      <div ref="editorContainer" class="editor-canvas"></div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleFileUpload"
    />

    <!-- 说明面板 -->
    <div class="info-panel">
      <h3>操作说明:</h3>
      <ul>
        <li><strong>缩放:</strong> 鼠标滚轮缩放画布</li>
        <li><strong>平移:</strong> 按住 Shift + 左键拖拽 或 中键拖拽</li>
        <li><strong>空格移动:</strong> 按住空格键 + 左键拖拽移动画布</li>
        <li><strong>选择:</strong> 点击图像进行选择</li>
        <li><strong>移动:</strong> 拖拽选中的图像</li>
        <li><strong>缩放:</strong> 拖拽选择框的控制点</li>
        <li><strong>旋转:</strong> 拖拽旋转控制点</li>
        <li><strong>删除:</strong> 选中图像后按 Delete 键</li>
        <li><strong>撤销:</strong> Ctrl+Z</li>
        <li><strong>重做:</strong> Ctrl+Shift+Z</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.editor-app {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: Arial, sans-serif;
  background: #f0f0f0;
}

.header {
  background: white;
  padding: 20px;
  text-align: center;
  border-bottom: 1px solid #ddd;
}

.header h1 {
  margin: 0 0 10px 0;
  color: #333;
  font-size: 24px;
}

.header p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.toolbar {
  background: white;
  padding: 15px;
  border-bottom: 1px solid #ddd;
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  align-items: center;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-group label {
  font-weight: bold;
  color: #555;
  font-size: 14px;
}

button {
  padding: 8px 12px;
  border: 1px solid #ddd;
  background: white;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  transition: all 0.2s;
}

button:hover:not(:disabled) {
  background: #f5f5f5;
  border-color: #ccc;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.active {
  background: #007ACC;
  color: white;
  border-color: #007ACC;
}

.zoom-level, .dpr-info {
  min-width: 50px;
  text-align: center;
  font-weight: bold;
  color: #333;
}

.editor-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  background: #f5f5f5;
}

.editor-canvas {
  border: 2px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  background: white;
  overflow: hidden;
}

.info-panel {
  background: white;
  padding: 20px;
  border-top: 1px solid #ddd;
  max-height: 200px;
  overflow-y: auto;
}

.info-panel h3 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 16px;
}

.info-panel ul {
  margin: 0;
  padding-left: 20px;
}

.info-panel li {
  margin-bottom: 8px;
  color: #555;
  font-size: 14px;
  line-height: 1.4;
}

.info-panel strong {
  color: #333;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .tool-group {
    justify-content: center;
  }
  
  .editor-container {
    padding: 10px;
  }
  
  .info-panel {
    font-size: 12px;
  }
}
</style>
