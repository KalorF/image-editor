<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, watch } from 'vue';
import { Editor, GridPlugin, MaskBrushPlugin, ColorSelectionPlugin } from '../editor';

interface Props {
  originalImage?: string;
  previewImage?: string;
  gridEnabled?: boolean;
  spacePanEnabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  gridEnabled: true,
  spacePanEnabled: true,
});

const emit = defineEmits<{
  'editor:initialized': [{ originalEditor: Editor, previewEditor: Editor }];
  'editor:destroyed': [];
}>();

const originalContainer = ref<HTMLElement>();
const previewContainer = ref<HTMLElement>();
let originalEditor: Editor | null = null;
let previewEditor: Editor | null = null;

// 状态管理
const originalZoom = ref(100);
const previewZoom = ref(100);

// 同步控制标志，防止无限循环
let isSyncing = false;

// 简化的同步控制
let isObjectSyncing = false;

// 工具状态管理
const currentTool = ref('maskBrush'); // 默认启用涂抹工具

onMounted(() => {
  initializeEditors();
});

onBeforeUnmount(() => {
  cleanup();
});

const initializeEditors = async () => {
  if (!originalContainer.value || !previewContainer.value) return;

  try {
    // 创建原图编辑器
    originalEditor = new Editor({
      container: originalContainer.value,
      enableSpacePan: props.spacePanEnabled,
      plugins: [
        new GridPlugin({ size: 8, checkerboard: true, showShadow: false }),
        new MaskBrushPlugin({ 
          brushSize: 20,
          mode: 'add',
          opacity: 0.4,
          color: '#2661f1'
        }),
        new ColorSelectionPlugin({
          tolerance: 32,
          selectionColor: '#00FF00',
          selectionOpacity: 0.3,
          mode: 'add',
          debug: true // 启用调试模式
        })
      ]
    });

    // 创建预览编辑器
    previewEditor = new Editor({
      container: previewContainer.value,
      enableSpacePan: props.spacePanEnabled,
      plugins: [
        new GridPlugin({ size: 8, checkerboard: true, showShadow: false }),
        new MaskBrushPlugin({ 
          brushSize: 20,
          mode: 'add',
          opacity: 0.4,
          color: '#2661f1'
        }),
        new ColorSelectionPlugin({
          tolerance: 32,
          selectionColor: '#00FF00',
          selectionOpacity: 0.3,
          mode: 'add',
          debug: true // 启用调试模式
        })
      ]
    });

    // 设置事件同步
    setupEventSync();

    // 网格状态同步
    if (!props.gridEnabled) {
      (originalEditor as any).grid?.hide();
      (previewEditor as any).grid?.hide();
    }

    // 空格移动功能同步
    if (!props.spacePanEnabled) {
      originalEditor.disableSpacePan();
      previewEditor.disableSpacePan();
    }

    // 添加示例图像
    await addSampleImages();

    // 发出初始化完成事件
    emit('editor:initialized', { originalEditor, previewEditor });

    // 初始同步视口状态
    setTimeout(() => {
      forceSyncViewports('original');
    }, 100);

    // 设置默认工具为涂抹工具
    setTool(currentTool.value);

    console.log('对比编辑器初始化完成');
  } catch (error) {
    console.error('编辑器初始化失败:', error);
  }
};



// 设置事件同步机制
const setupEventSync = () => {
  if (!originalEditor || !previewEditor) return;



  // 同步viewport缩放事件 - 统一使用forceSyncViewports
  originalEditor.viewport.on('viewport:zoom', () => {
    if (isSyncing) return;
    forceSyncViewports('original');
  });

  previewEditor.viewport.on('viewport:zoom', () => {
    if (isSyncing) return;
    forceSyncViewports('preview');
  });

  // 同步viewport平移事件 - 统一使用forceSyncViewports
  originalEditor.viewport.on('viewport:pan', () => {
    if (isSyncing) return;
    forceSyncViewports('original');
  });

  previewEditor.viewport.on('viewport:pan', () => {
    if (isSyncing) return;
    forceSyncViewports('preview');
  });

  // 同步选择事件 - 统一使用forceSyncViewports
  originalEditor.on('object:selected', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    forceSyncViewports('original');
  });

  originalEditor.on('object:deselected', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    forceSyncViewports('original');
  });

  previewEditor.on('object:selected', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    forceSyncViewports('original');
  });

  previewEditor.on('object:deselected', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    forceSyncViewports('original');
  });

  // 监听拖拽平移事件（用户直接拖拽画布）
  originalEditor.on('pan:move', () => {
    if (isSyncing) return;
    forceSyncViewports('original');
  });

  originalEditor.on('pan:end', () => {
    if (isSyncing) return;
    forceSyncViewports('original');
  });

  previewEditor.on('pan:move', () => {
    if (isSyncing) return;
    forceSyncViewports('preview');
  });

  previewEditor.on('pan:end', () => {
    if (isSyncing) return;
    forceSyncViewports('preview');
  });

  // 空格键平移事件不需要同步处理

  // 监听对象拖拽事件 - 简化的拖拽同步
  originalEditor.on('object:drag:move', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    syncObjectByIndex(event, 'original');
  });

  previewEditor.on('object:drag:move', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    syncObjectByIndex(event, 'preview');
  });

  // 监听对象变换事件 - 简化的变换同步
  const transformEvents = ['object:moved', 'object:scaled', 'object:rotated', 'object:resized'];
  
  transformEvents.forEach(eventType => {
    originalEditor!.on(eventType, (event: any) => {
      if (isSyncing || isObjectSyncing) return;
      syncObjectByIndex(event, 'original');
    });

    previewEditor!.on(eventType, (event: any) => {
      if (isSyncing || isObjectSyncing) return;
      syncObjectByIndex(event, 'preview');
    });
  });

  // 监听工具切换事件，同步插件状态
  originalEditor!.on('tool:changed', (event: any) => {
    const newTool = event.data?.newTool || event.newTool;
    
    // 同步mask brush状态
    if ((originalEditor as any).maskBrush) {
      if (newTool === 'maskBrush') {
        (originalEditor as any).maskBrush.enable();
      } else {
        (originalEditor as any).maskBrush.disable();
      }
    }
    
    // 同步颜色选区状态
    if ((originalEditor as any).colorSelection) {
      if (newTool === 'colorSelection') {
        (originalEditor as any).colorSelection.enable();
      } else {
        (originalEditor as any).colorSelection.disable();
      }
    }
  });

  previewEditor!.on('tool:changed', (event: any) => {
    const newTool = event.data?.newTool || event.newTool;
    
    // 同步mask brush状态
    if ((previewEditor as any).maskBrush) {
      if (newTool === 'maskBrush') {
        (previewEditor as any).maskBrush.enable();
      } else {
        (previewEditor as any).maskBrush.disable();
      }
    }
    
    // 同步颜色选区状态
    if ((previewEditor as any).colorSelection) {
      if (newTool === 'colorSelection') {
        (previewEditor as any).colorSelection.enable();
      } else {
        (previewEditor as any).colorSelection.disable();
      }
    }
  });

  // 监听mask变化事件
  originalEditor!.on('mask:changed', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    // mask变化不需要特殊同步，因为两个编辑器都是独立的
  });

  previewEditor!.on('mask:changed', (event: any) => {
    if (isSyncing || isObjectSyncing) return;
    // mask变化不需要特殊同步，因为两个编辑器都是独立的
  });
};

// 基于索引的对象同步 - 更简单可靠的方法
const syncObjectByIndex = (event: any, sourceEditor: 'original' | 'preview') => {
  if (isSyncing || isObjectSyncing || !originalEditor || !previewEditor) return;
  
  isObjectSyncing = true;
  
  const sourceObject = event.object || event.data?.object || event.target;
  if (!sourceObject) {
    setTimeout(() => { isObjectSyncing = false; }, 5);
    return;
  }
  

  
  // 确定源和目标编辑器
  const sourceObjectManager = sourceEditor === 'original' ? originalEditor.objectManager : previewEditor.objectManager;
  const targetEditor = sourceEditor === 'original' ? previewEditor : originalEditor;
  const targetObjectManager = targetEditor.objectManager;
  
  // 获取对象列表
  const sourceObjects = (sourceObjectManager as any).objects || [];
  const targetObjects = (targetObjectManager as any).objects || [];
  
  // 找到源对象在列表中的索引
  const sourceIndex = sourceObjects.indexOf(sourceObject);
  
  if (sourceIndex >= 0 && sourceIndex < targetObjects.length) {
    const targetObject = targetObjects[sourceIndex];
    
    // 同步所有变换属性
    if (sourceObject.transform && targetObject.transform) {
      targetObject.transform.x = sourceObject.transform.x;
      targetObject.transform.y = sourceObject.transform.y;
      targetObject.transform.scaleX = sourceObject.transform.scaleX || 1;
      targetObject.transform.scaleY = sourceObject.transform.scaleY || 1;
      targetObject.transform.rotation = sourceObject.transform.rotation || 0;
    }
    
    // 同步尺寸属性
    if (sourceObject.width !== undefined) targetObject.width = sourceObject.width;
    if (sourceObject.height !== undefined) targetObject.height = sourceObject.height;
    
    // 如果有setPosition方法，使用它来确保正确的位置更新
    if (targetObject.setPosition && typeof targetObject.setPosition === 'function') {
      targetObject.setPosition(sourceObject.transform.x, sourceObject.transform.y);
    }
    
    // 触发重新渲染
    targetEditor.requestRender();
    
  }
  
  setTimeout(() => { isObjectSyncing = false; }, 5);
};



const addSampleImages = async () => {
  if (!originalEditor || !previewEditor) return;

  // 创建原图示例
  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = 300;
  originalCanvas.height = 200;
  const originalCtx = originalCanvas.getContext('2d')!;
  
  // 原图渐变背景
  const originalGradient = originalCtx.createLinearGradient(0, 0, 300, 200);
  originalGradient.addColorStop(0, '#FF6B6B');
  originalGradient.addColorStop(1, '#4ECDC4');
  originalCtx.fillStyle = originalGradient;
  originalCtx.fillRect(0, 0, 300, 200);
  
  // 添加原图标签
  originalCtx.fillStyle = 'white';
  originalCtx.font = 'bold 24px Arial';
  originalCtx.textAlign = 'center';
  originalCtx.fillText('原图', 150, 110);

  const originalDataURL = originalCanvas.toDataURL();

  // 创建预览图示例（稍微不同的颜色）
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 300;
  previewCanvas.height = 200;
  const previewCtx = previewCanvas.getContext('2d')!;
  
  // 预览图渐变背景（不同颜色）
  const previewGradient = previewCtx.createLinearGradient(0, 0, 300, 200);
  previewGradient.addColorStop(0, '#667eea');
  previewGradient.addColorStop(1, '#764ba2');
  previewCtx.fillStyle = previewGradient;
  previewCtx.fillRect(0, 0, 300, 200);
  
  // 添加预览图标签
  previewCtx.fillStyle = 'white';
  previewCtx.font = 'bold 24px Arial';
  previewCtx.textAlign = 'center';
  previewCtx.fillText('预览', 150, 110);

  const previewDataURL = previewCanvas.toDataURL();

  try {
    // 添加图片到编辑器
    await originalEditor.addImage({src: originalDataURL, x: 100, y: 100, needRecord: false});
    await previewEditor.addImage({src: previewDataURL, x: 100, y: 100, needRecord: false});
    console.log('对比图像添加成功');
  } catch (error) {
    console.error('添加对比图像失败:', error);
  }
};

// 工具管理
const setTool = (tool: string) => {
  currentTool.value = tool;
  
  if (originalEditor) {
    originalEditor.setTool(tool);
  }
  if (previewEditor) {
    previewEditor.setTool(tool);
  }
  

};

// 设置涂抹工具参数
const setBrushSize = (size: number) => {
  if (originalEditor && (originalEditor as any).maskBrush) {
    (originalEditor as any).maskBrush.setBrushSize(size);
  }
  if (previewEditor && (previewEditor as any).maskBrush) {
    (previewEditor as any).maskBrush.setBrushSize(size);
  }
};

const setBrushMode = (mode: 'add' | 'remove') => {
  if (originalEditor && (originalEditor as any).maskBrush) {
    (originalEditor as any).maskBrush.setMode(mode);
  }
  if (previewEditor && (previewEditor as any).maskBrush) {
    (previewEditor as any).maskBrush.setMode(mode);
  }
};

const setBrushOpacity = (opacity: number) => {
  if (originalEditor && (originalEditor as any).maskBrush) {
    (originalEditor as any).maskBrush.setOpacity(opacity);
  }
  if (previewEditor && (previewEditor as any).maskBrush) {
    (previewEditor as any).maskBrush.setOpacity(opacity);
  }
};

const setBrushColor = (color: string) => {
  if (originalEditor && (originalEditor as any).maskBrush) {
    (originalEditor as any).maskBrush.setColor(color);
  }
  if (previewEditor && (previewEditor as any).maskBrush) {
    (previewEditor as any).maskBrush.setColor(color);
  }
};

const clearMask = () => {
  if (originalEditor && (originalEditor as any).maskBrush) {
    (originalEditor as any).maskBrush.clearMask();
  }
  if (previewEditor && (previewEditor as any).maskBrush) {
    (previewEditor as any).maskBrush.clearMask();
  }
};

// 颜色选区工具参数设置
const setColorSelectionTolerance = (tolerance: number) => {
  if (originalEditor && (originalEditor as any).colorSelection) {
    (originalEditor as any).colorSelection.setTolerance(tolerance);
  }
  if (previewEditor && (previewEditor as any).colorSelection) {
    (previewEditor as any).colorSelection.setTolerance(tolerance);
  }
};

const setColorSelectionColor = (color: string) => {
  if (originalEditor && (originalEditor as any).colorSelection) {
    (originalEditor as any).colorSelection.setSelectionColor(color);
  }
  if (previewEditor && (previewEditor as any).colorSelection) {
    (previewEditor as any).colorSelection.setSelectionColor(color);
  }
};

const setColorSelectionOpacity = (opacity: number) => {
  if (originalEditor && (originalEditor as any).colorSelection) {
    (originalEditor as any).colorSelection.setSelectionOpacity(opacity);
  }
  if (previewEditor && (previewEditor as any).colorSelection) {
    (previewEditor as any).colorSelection.setSelectionOpacity(opacity);
  }
};

const clearColorSelection = () => {
  if (originalEditor && (originalEditor as any).colorSelection) {
    (originalEditor as any).colorSelection.clearSelection();
  }
  if (previewEditor && (previewEditor as any).colorSelection) {
    (previewEditor as any).colorSelection.clearSelection();
  }
};

const setColorSelectionMode = (mode: 'add' | 'remove') => {
  if (originalEditor && (originalEditor as any).colorSelection) {
    (originalEditor as any).colorSelection.setMode(mode);
  }
  if (previewEditor && (previewEditor as any).colorSelection) {
    (previewEditor as any).colorSelection.setMode(mode);
  }
};

const cleanup = () => {
  // 重置同步状态
  isSyncing = false;
  isObjectSyncing = false;
  
  if (originalEditor) {
    originalEditor.destroy();
    originalEditor = null;
  }
  if (previewEditor) {
    previewEditor.destroy();
    previewEditor = null;
  }
  emit('editor:destroyed');
};

// 强制同步两个编辑器的视口状态
const forceSyncViewports = (sourceEditor?: 'original' | 'preview') => {
  if (!originalEditor || !previewEditor || isSyncing) return;
  
  isSyncing = true;
  
  let sourceState, targetEditor;
  
  // 确定同步方向
  if (sourceEditor === 'preview') {
    sourceState = previewEditor.viewport.getState();
    targetEditor = originalEditor;
  } else {
    sourceState = originalEditor.viewport.getState();
    targetEditor = previewEditor;
  }

  
  // 同步到目标编辑器
  targetEditor.viewport.setState({
    zoom: sourceState.zoom,
    panX: sourceState.panX,
    panY: sourceState.panY
  });
  
  // 更新显示
  originalZoom.value = Math.round(originalEditor.viewport.zoom * 100);
  previewZoom.value = Math.round(previewEditor.viewport.zoom * 100);
  
  // 强制重新渲染
  originalEditor.requestRender();
  previewEditor.requestRender();
  

  
  setTimeout(() => { isSyncing = false; }, 10);
};

// 同步缩放操作
const syncZoomIn = () => {
  isSyncing = true;
  originalEditor?.zoomIn();
  previewEditor?.zoomIn();
  setTimeout(() => { 
    isSyncing = false; 
    forceSyncViewports('original');
  }, 50);
};

const syncZoomOut = () => {
  isSyncing = true;
  originalEditor?.zoomOut();
  previewEditor?.zoomOut();
  setTimeout(() => { 
    isSyncing = false; 
    forceSyncViewports('original');
  }, 50);
};

const syncResetZoom = () => {
  isSyncing = true;
  originalEditor?.resetZoom();
  previewEditor?.resetZoom();
  setTimeout(() => { 
    isSyncing = false; 
    forceSyncViewports('original');
  }, 50);
};

const syncZoomToFit = () => {
  isSyncing = true;
  originalEditor?.zoomToFit();
  previewEditor?.zoomToFit();
  setTimeout(() => { 
    isSyncing = false; 
    forceSyncViewports('original');
  }, 50);
};

// 网格切换
const toggleGrid = () => {
  if (originalEditor && previewEditor) {
    const originalGrid = (originalEditor as any).grid;
    const previewGrid = (previewEditor as any).grid;
    
    if (props.gridEnabled) {
      originalGrid?.hide();
      previewGrid?.hide();
    } else {
      originalGrid?.show();
      previewGrid?.show();
    }
  }
};

// 空格移动切换
const toggleSpacePan = () => {
  if (originalEditor && previewEditor) {
    if (props.spacePanEnabled) {
      originalEditor.disableSpacePan();
      previewEditor.disableSpacePan();
    } else {
      originalEditor.enableSpacePan();
      previewEditor.enableSpacePan();
    }
  }
};

// 暴露方法供父组件调用
defineExpose({
  originalEditor: () => originalEditor,
  previewEditor: () => previewEditor,
  syncZoomIn,
  syncZoomOut,
  syncResetZoom,
  syncZoomToFit,
  forceSyncViewports,
  toggleGrid,
  toggleSpacePan,
  setTool,
  setBrushSize,
  setBrushMode,
  setBrushOpacity,
  setBrushColor,
  clearMask,
  setColorSelectionTolerance,
  setColorSelectionColor,
  setColorSelectionOpacity,
  setColorSelectionMode,
  clearColorSelection,
  currentTool: () => currentTool.value,
  cleanup
});
</script>

<template>
  <div class="comparison-view">
    <!-- 左侧原图 -->
    <div class="comparison-panel original-panel">
      <div class="panel-header">
        <h3 class="panel-title">Original</h3>
        <div class="header-controls">
          <button 
            @click="() => forceSyncViewports('original')" 
            class="sync-button"
            title="强制同步视口">
            🔄
          </button>
          <div class="zoom-indicator">{{ originalZoom }}%</div>
        </div>
      </div>
      <div class="editor-container">
        <div ref="originalContainer" class="editor-canvas"></div>
      </div>
    </div>

    <!-- 分割线 -->
    <div class="divider"></div>

    <!-- 右侧预览图 -->
    <div class="comparison-panel preview-panel">
      <div class="panel-header">
        <h3 class="panel-title">Preview</h3>
        <div class="header-controls">
          <button 
            @click="() => forceSyncViewports('preview')" 
            class="sync-button"
            title="强制同步视口">
            🔄
          </button>
          <div class="zoom-indicator">{{ previewZoom }}%</div>
        </div>
      </div>
      <div class="editor-container">
        <div ref="previewContainer" class="editor-canvas"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comparison-view {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 2px;
  background: #e2e8f0;
  box-sizing: border-box;
}

.comparison-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-bottom: 1px solid #e2e8f0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.sync-button:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
  transform: scale(1.05);
}

.sync-button:active {
  transform: scale(0.95);
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
}

.original-panel .panel-title {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.preview-panel .panel-title {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.zoom-indicator {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  background: white;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  min-width: 50px;
  text-align: center;
}

.editor-container {
  flex: 1;
  min-height: 0;
  position: relative;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
}

.editor-canvas {
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: white;
  position: relative;
  box-sizing: border-box;
}

.editor-canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.divider {
  width: 2px;
  background: linear-gradient(180deg, #3b82f6, #1d4ed8);
  border-radius: 1px;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
}

/* 悬停效果 */
.comparison-panel:hover {
  /* transform: translateY(-1px); */
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.15);
  /* transition: all 0.3s ease; */
}

.comparison-panel:hover .panel-header {
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .comparison-view {
    flex-direction: column;
    gap: 2px;
    height: 100%;
  }
  
  .comparison-panel {
    flex: 1;
    min-height: 300px;
  }
  
  .panel-header {
    padding: 12px 16px;
  }
  
  .panel-title {
    font-size: 14px;
  }
  
  .zoom-indicator {
    font-size: 11px;
    padding: 3px 10px;
  }
  
  .editor-canvas {
    min-height: 250px;
  }
}
</style>