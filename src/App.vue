<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, watch, nextTick } from 'vue';
import { Editor, GridPlugin, MaskBrushPlugin, ColorSelectionPlugin } from './editor';
import ComparisonView from './components/ComparisonView.vue';

const editorContainer = ref<HTMLElement>();
let editor: Editor | null = null;

// 视图模式管理
const viewMode = ref<'single' | 'comparison'>('single');
const comparisonView = ref<InstanceType<typeof ComparisonView>>();

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
const maskBrushOpacity = ref(0.3);
const maskBrushColor = ref('#00FF00');

// 颜色选区相关状态
const colorSelectionTolerance = ref(32);
const colorSelectionColor = ref('#00FF00');
const colorSelectionOpacity = ref(0.3);
const colorSelectionMode = ref<'add' | 'remove'>('add');

// DPR 调试信息
const devicePixelRatio = ref(window.devicePixelRatio || 1);

// 帮助面板显示状态
const showHelp = ref(false);

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
  createEditor();
});

// 创建编辑器实例的函数
const createEditor = () => {
  if (!editorContainer.value || editor) return;
  
  console.log('创建编辑器实例');
  editor = new Editor({
    container: editorContainer.value,
    enableSpacePan: true, // 启用空格键移动画布功能
    plugins: [
      new GridPlugin({ size: 8, checkerboard: true, showShadow: false }),
      new MaskBrushPlugin({ 
        brushSize: maskBrushSize.value,
        mode: maskBrushMode.value,
        opacity: maskBrushOpacity.value,
        color: maskBrushColor.value
      }),
      new ColorSelectionPlugin({
        tolerance: colorSelectionTolerance.value,
        selectionColor: colorSelectionColor.value,
        selectionOpacity: colorSelectionOpacity.value,
        mode: colorSelectionMode.value,
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
  editor.on('history:state-captured', () => {
    canUndo.value = !!editor?.history?.canUndo();
    canRedo.value = !!editor?.history?.canRedo();
  });

  editor.on('history:undo', () => {
    canUndo.value = !!editor?.history?.canUndo();
    canRedo.value = !!editor?.history?.canRedo();
  });

  editor.on('history:redo', () => {
    canUndo.value = !!editor?.history?.canUndo();
    canRedo.value = !!editor?.history?.canRedo();
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

  // 监听窗口大小变化，动态调整编辑器尺寸
  const handleResize = () => {
    if (editor && editorContainer.value) {
      const canvas = editorContainer.value.querySelector('canvas');
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const width = editorContainer.value.clientWidth;
        const height = editorContainer.value.clientHeight;
        
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        
        // 重新渲染
        editor.requestRender();
      }
    }
  };

  window.addEventListener('resize', handleResize);
  
  // 初始化后立即调整尺寸
  setTimeout(handleResize, 100);
  
  // 添加一些示例图像
  addSampleImages();
  
  // 在组件卸载时清理
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
    if (editor) {
      editor.destroy();
    }
  });
};

// 监听视图模式变化，确保在切换回单画布时重新创建编辑器
watch(viewMode, async (newMode, oldMode) => {
  console.log('视图模式变化:', { from: oldMode, to: newMode });
  
  if (newMode === 'single' && oldMode === 'comparison') {
    // 从对比模式切换回单画布模式时，需要重新创建编辑器
    if (editor) {
      editor.destroy();
      editor = null;
    }
    
    // 等待DOM更新
    await nextTick();
    createEditor();
  }
});

// 添加示例图像
const addSampleImages = () => {
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
  
  editor.importByJson([{src: dataURL, x: 100, y: 100, type: 'image'}])
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
  if (editor) {
    editor.undo();
  }
};

const redo = () => {
  if (editor) {
    editor.redo();
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
      editor!.addImage({src: dataURL}).then((imageObj) => {
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
  editor.importByJson([{src: dataURL, x: 100, y: 100, type: 'image'}])
  };

// Mask Brush 相关功能
const toggleMaskBrush = () => {
  if (viewMode.value === 'single' && editor) {
    if (selectedTool.value === 'maskBrush') {
      setTool('select');
    } else {
      setTool('maskBrush');
    }
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    if (selectedTool.value === 'maskBrush') {
      selectedTool.value = 'select';
      comparisonView.value.setTool('select');
    } else {
      selectedTool.value = 'maskBrush';
      comparisonView.value.setTool('maskBrush');
    }
  }
};

// 颜色选区工具相关功能
const toggleColorSelection = () => {
  if (viewMode.value === 'single' && editor) {
    if (selectedTool.value === 'colorSelection') {
      setTool('select');
    } else {
      setTool('colorSelection');
    }
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    if (selectedTool.value === 'colorSelection') {
      selectedTool.value = 'select';
      comparisonView.value.setTool('select');
    } else {
      selectedTool.value = 'colorSelection';
      comparisonView.value.setTool('colorSelection');
    }
  }
};

const setBrushSize = (size: number) => {
  maskBrushSize.value = size;
  if (viewMode.value === 'single' && editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setBrushSize(size);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setBrushSize(size);
  }
};

const setBrushMode = (mode: 'add' | 'remove') => {
  maskBrushMode.value = mode;
  if (viewMode.value === 'single' && editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setMode(mode);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setBrushMode(mode);
  }
};

const setColorSelectionMode = (mode: 'add' | 'remove') => {
  colorSelectionMode.value = mode;
  if (viewMode.value === 'single' && editor && (editor as any).colorSelection) {
    (editor as any).colorSelection.setMode(mode);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setColorSelectionMode(mode);
  }
};

const setColorSelectionTolerance = (tolerance: number) => {
  colorSelectionTolerance.value = tolerance;
  if (viewMode.value === 'single' && editor && (editor as any).colorSelection) {
    (editor as any).colorSelection.setTolerance(tolerance);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setColorSelectionTolerance(tolerance);
  }
};

const setColorSelectionColor = (color: string) => {
  colorSelectionColor.value = color;
  if (viewMode.value === 'single' && editor && (editor as any).colorSelection) {
    (editor as any).colorSelection.setSelectionColor(color);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setColorSelectionColor(color);
  }
};

const setColorSelectionOpacity = (opacity: number) => {
  colorSelectionOpacity.value = opacity;
  if (viewMode.value === 'single' && editor && (editor as any).colorSelection) {
    (editor as any).colorSelection.setSelectionOpacity(opacity);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setColorSelectionOpacity(opacity);
  }
};

const clearColorSelection = () => {
  if (viewMode.value === 'single' && editor && (editor as any).colorSelection) {
    (editor as any).colorSelection.clearSelection();
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.clearColorSelection();
  }
};

const setBrushOpacity = (opacity: number) => {
  maskBrushOpacity.value = opacity;
  if (viewMode.value === 'single' && editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setOpacity(opacity);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setBrushOpacity(opacity);
  }
};

const setBrushColor = (color: string) => {
  maskBrushColor.value = color;
  if (viewMode.value === 'single' && editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.setColor(color);
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.setBrushColor(color);
  }
};

const clearMask = () => {
  if (viewMode.value === 'single' && editor && (editor as any).maskBrush) {
    (editor as any).maskBrush.clearMask();
  } else if (viewMode.value === 'comparison' && comparisonView.value) {
    comparisonView.value.clearMask();
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
  editor.addImage({src: dataURL, x: 100, y: 100, needRecord: false}).then((imageObj) => {
    console.log('指定位置图像添加成功:', imageObj.transform);
  });
};

// 视图模式切换功能
const toggleViewMode = () => {
  viewMode.value = viewMode.value === 'single' ? 'comparison' : 'single';
  console.log('切换视图模式:', viewMode.value);
};

// 对比模式下的编辑器事件处理
const handleComparisonEditorInit = ({ originalEditor, previewEditor }: { originalEditor: Editor, previewEditor: Editor }) => {
  console.log('对比编辑器初始化完成:', { originalEditor, previewEditor });
};

const handleComparisonEditorDestroy = () => {
  console.log('对比编辑器已销毁');
};

// 根据模式执行缩放操作
const performZoomIn = () => {
  if (viewMode.value === 'single') {
    zoomIn();
  } else {
    comparisonView.value?.syncZoomIn();
  }
};

const performZoomOut = () => {
  if (viewMode.value === 'single') {
    zoomOut();
  } else {
    comparisonView.value?.syncZoomOut();
  }
};

const performResetZoom = () => {
  if (viewMode.value === 'single') {
    resetZoom();
  } else {
    comparisonView.value?.syncResetZoom();
  }
};

const performZoomToFit = () => {
  if (viewMode.value === 'single') {
    zoomToFit();
  } else {
    comparisonView.value?.syncZoomToFit();
  }
};

// 根据模式执行网格切换
const performToggleGrid = () => {
  if (viewMode.value === 'single') {
    toggleGrid();
  } else {
    gridEnabled.value = !gridEnabled.value;
    comparisonView.value?.toggleGrid();
  }
};

// 根据模式执行空格移动切换
const performToggleSpacePan = () => {
  if (viewMode.value === 'single') {
    toggleSpacePan();
  } else {
    spacePanEnabled.value = !spacePanEnabled.value;
    comparisonView.value?.toggleSpacePan();
  }
};
</script>

<template>
  <div class="editor-app">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-content">
        <div class="logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
            <path d="M21 15l-5-5L5 21l5-5" stroke="currentColor" stroke-width="2"/>
          </svg>
          <h1>图像编辑器</h1>
        </div>
        
        <!-- 顶部操作栏 -->
        <div class="top-actions">
          <!-- 视图模式切换 -->
          <div class="view-mode-controls">
            <button 
              :class="{ active: viewMode === 'single' }"
              @click="viewMode = 'single'" 
              class="mode-btn" 
              title="单画布模式"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                <path d="M21 15l-5-5L5 21l5-5" stroke="currentColor" stroke-width="2"/>
              </svg>
              单画布
            </button>
            <button 
              :class="{ active: viewMode === 'comparison' }"
              @click="viewMode = 'comparison'" 
              class="mode-btn" 
              title="对比模式"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="8" height="18" rx="1" stroke="currentColor" stroke-width="2"/>
                <rect x="13" y="3" width="8" height="18" rx="1" stroke="currentColor" stroke-width="2"/>
                <line x1="11" y1="3" x2="11" y2="21" stroke="currentColor" stroke-width="2"/>
              </svg>
              对比
            </button>
          </div>

          <!-- 缩放控制 -->
          <div class="zoom-controls">
            <button @click="performZoomOut" class="zoom-btn" title="缩小 (-)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="M8 11H14" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
            <span class="zoom-display">{{ viewMode === 'single' ? zoomLevel : '同步' }}%</span>
            <button @click="performZoomIn" class="zoom-btn" title="放大 (+)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="M11 8V14M8 11H14" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
            <button @click="performResetZoom" class="reset-btn" title="重置缩放 (0)">1:1</button>
            <button @click="performZoomToFit" class="fit-btn" title="适应窗口 (Ctrl+0)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
          
          <!-- 历史操作 -->
          <div class="history-controls">
            <button :disabled="!canUndo" @click="undo" class="history-btn" title="撤销 (Ctrl+Z)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 7V13a4 4 0 0 0 4 4h7" stroke="currentColor" stroke-width="2"/>
                <path d="M7 7L3 7L3 3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
            <button :disabled="!canRedo" @click="redo" class="history-btn" title="重做 (Ctrl+Y)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M21 7V13a4 4 0 0 0-4 4H10" stroke="currentColor" stroke-width="2"/>
                <path d="M17 7L21 7L21 3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
          
          <!-- 状态信息 -->
          <div class="status-info">
            <div class="status-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
                <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" stroke-width="2"/>
                <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-width="2"/>
              </svg>
              DPR: {{ devicePixelRatio }}x
            </div>
            <div class="status-item" v-if="editor && editor.getSelectedObject()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                <circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="2"/>
                <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" stroke="currentColor" stroke-width="2"/>
              </svg>
              已选中
            </div>
          </div>
        </div>
        
        <!-- 文件操作 -->
        <div class="header-actions">
          <button @click="uploadImage" class="action-btn primary" title="上传图片">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2"/>
              <line x1="12" y1="18" x2="12" y2="12" stroke="currentColor" stroke-width="2"/>
              <polyline points="9,15 12,12 15,15" stroke="currentColor" stroke-width="2"/>
            </svg>
            上传
          </button>
          <button @click="exportImage" class="action-btn" title="导出图片">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2"/>
              <polyline points="7,10 12,15 17,10" stroke="currentColor" stroke-width="2"/>
              <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2"/>
            </svg>
            导出
          </button>
        </div>
      </div>
    </header>

    <!-- 主工作区 - 左右布局 -->
    <div class="main-workspace">
      <!-- 左侧工具面板 -->
      <aside class="left-panel">
        <!-- 工具选择区 -->
        <div class="panel-section">
          <div class="section-header">
            <h3>工具箱</h3>
            <div class="section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
          </div>
          <div class="tool-grid">
            <button 
              :class="{ active: selectedTool === 'select' }"
              @click="setTool('select')"
              class="tool-item"
              title="选择工具 (V)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 3L21 9L12 12L9 21L3 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              </svg>
              <span>选择</span>
            </button>
            <button 
              :class="{ active: selectedTool === 'maskBrush' }"
              @click="toggleMaskBrush"
              class="tool-item"
              title="蒙版笔刷 (B)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" stroke-width="2"/>
              </svg>
              <span>涂抹</span>
            </button>
            <button 
              :class="{ active: selectedTool === 'colorSelection' }"
              @click="toggleColorSelection"
              class="tool-item"
              title="颜色选区 (C)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/>
                <circle cx="12" cy="12" r="2" fill="currentColor"/>
              </svg>
              <span>颜色选区</span>
            </button>
          </div>
        </div>

        <!-- 笔刷设置面板 -->
        <div class="panel-section" v-if="selectedTool === 'maskBrush'">
          <div class="section-header">
            <h3>笔刷设置</h3>
            <div class="section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
          </div>
          <div class="brush-settings">
            <div class="setting-item">
              <label>大小</label>
              <div class="slider-container">
                <input 
                  type="range" 
                  min="5" 
                  max="100" 
                  v-model="maskBrushSize"
                  @input="setBrushSize(Number(($event.target as HTMLInputElement).value))"
                  class="slider"
                />
                <span class="value">{{ maskBrushSize }}</span>
              </div>
            </div>
            
            <div class="setting-item">
              <label>透明度</label>
              <div class="slider-container">
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.1"
                  v-model="maskBrushOpacity"
                  @input="setBrushOpacity(Number(($event.target as HTMLInputElement).value))"
                  class="slider"
                />
                <span class="value">{{ Math.round(maskBrushOpacity * 100) }}%</span>
              </div>
            </div>
            
            <div class="setting-item">
              <label>模式</label>
              <div class="mode-buttons">
                <button 
                  :class="{ active: maskBrushMode === 'add' }"
                  @click="setBrushMode('add')"
                  class="mode-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2"/>
                    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  添加
                </button>
                <button 
                  :class="{ active: maskBrushMode === 'remove' }"
                  @click="setBrushMode('remove')"
                  class="mode-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  移除
                </button>
              </div>
            </div>
            
            <div class="setting-item">
              <label>颜色</label>
              <input 
                type="color" 
                v-model="maskBrushColor"
                @input="setBrushColor(($event.target as HTMLInputElement).value)"
                class="color-picker"
              />
            </div>
            
            <div class="setting-item">
              <button @click="clearMask" class="clear-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6h18" stroke="currentColor" stroke-width="2"/>
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" stroke-width="2"/>
                  <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="2"/>
                  <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="2"/>
                </svg>
                清除蒙版
              </button>
            </div>
          </div>
        </div>

        <!-- 颜色选区设置面板 -->
        <div class="panel-section" v-if="selectedTool === 'colorSelection'">
          <div class="section-header">
            <h3>颜色选区设置</h3>
            <div class="section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/>
                <circle cx="12" cy="12" r="2" fill="currentColor"/>
              </svg>
            </div>
          </div>
          <div class="color-selection-settings">
            <!-- <div class="setting-item">
              <label>容差</label>
              <div class="slider-container">
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  v-model="colorSelectionTolerance"
                  @input="setColorSelectionTolerance(Number(($event.target as HTMLInputElement).value))"
                  class="slider"
                />
                <span class="value">{{ colorSelectionTolerance }}</span>
              </div>
            </div>
            
            <div class="setting-item">
              <label>透明度</label>
              <div class="slider-container">
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.1"
                  v-model="colorSelectionOpacity"
                  @input="setColorSelectionOpacity(Number(($event.target as HTMLInputElement).value))"
                  class="slider"
                />
                <span class="value">{{ Math.round(colorSelectionOpacity * 100) }}%</span>
              </div>
            </div> -->
            
            <div class="setting-item">
              <label>模式</label>
              <div class="mode-buttons">
                <button 
                  :class="{ active: colorSelectionMode === 'add' }"
                  @click="setColorSelectionMode('add')"
                  class="mode-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2"/>
                    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  添加
                </button>
                <button 
                  :class="{ active: colorSelectionMode === 'remove' }"
                  @click="setColorSelectionMode('remove')"
                  class="mode-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  移除
                </button>
              </div>
            </div>
            
            <!-- <div class="setting-item">
              <label>颜色</label>
              <input 
                type="color" 
                v-model="colorSelectionColor"
                @input="setColorSelectionColor(($event.target as HTMLInputElement).value)"
                class="color-picker"
              />
            </div> -->
            
            <!-- <div class="setting-item">
              <button @click="clearColorSelection" class="clear-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6h18" stroke="currentColor" stroke-width="2"/>
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" stroke-width="2"/>
                  <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="2"/>
                  <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="2"/>
                </svg>
                清除选区
              </button>
            </div> -->
          </div>
        </div>

        <!-- 视图选项面板 -->
        <div class="panel-section">
          <div class="section-header">
            <h3>视图选项</h3>
            <div class="section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
          </div>
          <div class="view-options">
            <button :class="{ active: gridEnabled }" @click="performToggleGrid" class="option-btn" title="显示网格">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" stroke="currentColor" stroke-width="2"/>
                <rect x="14" y="3" width="7" height="7" stroke="currentColor" stroke-width="2"/>
                <rect x="3" y="14" width="7" height="7" stroke="currentColor" stroke-width="2"/>
                <rect x="14" y="14" width="7" height="7" stroke="currentColor" stroke-width="2"/>
              </svg>
              网格
            </button>
            <button :class="{ active: spacePanEnabled }" @click="performToggleSpacePan" class="option-btn" title="空格键平移">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
                <rect x="8" y="8" width="8" height="4" rx="1" fill="currentColor"/>
              </svg>
              空格移动
            </button>
          </div>
        </div>
      </aside>

      <!-- 右侧画布区域 -->
      <main class="canvas-area">
        <!-- 单画布模式 -->
        <div v-if="viewMode === 'single'" class="canvas-container">
          <div ref="editorContainer" class="editor-canvas"></div>
        </div>
        
        <!-- 对比模式 -->
        <div v-else class="comparison-container">
          <ComparisonView 
            ref="comparisonView"
            :grid-enabled="gridEnabled"
            :space-pan-enabled="spacePanEnabled"
            @editor:initialized="handleComparisonEditorInit"
            @editor:destroyed="handleComparisonEditorDestroy"
          />
        </div>
      </main>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleFileUpload"
    />
  </div>
</template>

<style>
body {
  margin: 0;
  padding: 0;
}
</style>

<style scoped>
.editor-app {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  background: #f8fafc;
  color: #2d3748;
  overflow: hidden;
}

/* 顶部导航栏 */
.header {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  box-shadow: 0 4px 32px rgba(59, 130, 246, 0.15);
  z-index: 100;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 64px;
  max-width: 1800px;
  margin: 0 auto;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
}

.logo svg {
  color: rgba(255, 255, 255, 0.95);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.logo h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  background: linear-gradient(45deg, #ffffff, #dbeafe);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 顶部操作栏 */
.top-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 缩放控制 */
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  padding: 6px;
  backdrop-filter: blur(20px);
}

.zoom-btn, .reset-btn, .fit-btn {
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
}

.zoom-btn:hover, .reset-btn:hover, .fit-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.zoom-display {
  min-width: 70px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.reset-btn, .fit-btn {
  font-size: 12px;
  font-weight: 600;
}

/* 历史控制 */
.history-controls {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 4px;
}

.history-btn {
  padding: 10px;
  border: none;
  background: transparent;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 状态项 */
.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

/* 文件操作按钮 */
.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.3s ease;
  backdrop-filter: blur(20px);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
}

.action-btn.primary {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
}

/* 视图模式控制 */
.view-mode-controls {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  transform: translateY(-1px);
}

.mode-btn.active {
  background: rgba(255, 255, 255, 0.25);
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 主工作区 - 左右布局 */
.main-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧工具面板 */
.left-panel {
  width: 320px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-right: 1px solid #e2e8f0;
  box-shadow: 2px 0 20px rgba(0, 0, 0, 0.05);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.panel-section {
  padding: 24px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.section-icon {
  color: #94a3b8;
  opacity: 0.7;
}

/* 工具网格 */
.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border: 2px solid #e2e8f0;
  background: white;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 600;
  color: #475569;
  position: relative;
  overflow: hidden;
}

.tool-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.tool-item:hover {
  border-color: #bfdbfe;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
}

.tool-item:hover::before {
  opacity: 0.05;
}

.tool-item.active {
  border-color: #2563eb;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
}

.tool-item span {
  position: relative;
  z-index: 1;
  font-size: 13px;
}

/* 笔刷设置 */
.brush-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 颜色选区设置 */
.color-selection-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item label {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f8fafc;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, #e2e8f0, #cbd5e0);
  outline: none;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  transition: all 0.3s ease;
}

.slider:hover {
  background: linear-gradient(to right, #bfdbfe, #93c5fd);
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  border: 3px solid white;
  transition: all 0.3s ease;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  border: 3px solid white;
  transition: all 0.3s ease;
}

.value {
  font-size: 12px;
  font-weight: 700;
  color: #1e40af;
  min-width: 40px;
  text-align: center;
  background: white;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.mode-buttons {
  display: flex;
  background: #f8fafc;
  border-radius: 12px;
  padding: 4px;
  border: 1px solid #e2e8f0;
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: #6b7280;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.mode-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.mode-btn.active {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.color-picker {
  width: 100%;
  height: 48px;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: none;
}

.color-picker:hover {
  border-color: #3b82f6;
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border: 2px solid #ef4444;
  background: white;
  color: #ef4444;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.3s ease;
  width: 100%;
}

.clear-btn:hover {
  background: #ef4444;
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(239, 68, 68, 0.3);
}

/* 视图选项 */
.view-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border: 2px solid #e2e8f0;
  background: white;
  color: #475569;
  border-radius: 16px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.option-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.option-btn:hover {
  border-color: #bfdbfe;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
}

.option-btn:hover::before {
  opacity: 0.05;
}

.option-btn.active {
  border-color: #2563eb;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
}

.option-btn svg,
.option-btn span {
  position: relative;
  z-index: 1;
}

/* 右侧画布区域 */
.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  position: relative;
}

.canvas-container {
  flex: 1;
  display: flex;
  padding: 0px;
  position: relative;
}

.comparison-container {
  flex: 1;
  display: flex;
}

.editor-canvas {
  flex: 1;
  width: 100%;
  height: 100%;
  /* border: 2px solid #bfdbfe; */
  border-radius: 16px;
  box-shadow: 
    0 20px 50px rgba(59, 130, 246, 0.1),
    0 8px 30px rgba(0, 0, 0, 0.05);
  background: white;
  overflow: hidden;
  /* transition: all 0.4s ease; */
  position: relative;
}

.editor-canvas::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border-radius: 16px;
  z-index: -1;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.editor-canvas:hover::before {
  opacity: 1;
}

.editor-canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .left-panel {
    width: 280px;
  }
  
  .panel-section {
    padding: 20px;
  }
  
  .canvas-container {
    padding: 15px;
  }
}

@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    height: auto;
    padding: 16px 20px;
    gap: 16px;
  }
  
  .top-actions {
    order: -1;
    justify-content: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  
  .main-workspace {
    flex-direction: column;
  }
  
  .left-panel {
    width: 100%;
    max-height: 300px;
    border-right: none;
    border-bottom: 1px solid #e2e8f0;
  }
  
  .tool-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  
  .tool-item {
    padding: 16px 12px;
  }
  
  .canvas-container {
    padding: 10px;
  }
  
  .panel-section {
    padding: 16px;
  }
  
  .brush-settings {
    gap: 16px;
  }
  
  .view-options {
    flex-direction: row;
    gap: 8px;
  }
}
</style>
