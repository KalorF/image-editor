// 对象管理器
import { BaseObject } from '../objects/BaseObject';
import type { Point, Bounds } from '../types';
import { EventEmitter } from './EventEmitter';

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  objects: BaseObject[];
}

export class ObjectManager extends EventEmitter {
  private objects: BaseObject[] = [];
  private layers: LayerInfo[] = [];
  private activeLayerId: string = '';
  private zIndexCounter: number = 0;

  constructor() {
    super();
    this.createDefaultLayer();
  }

  // 创建默认图层
  private createDefaultLayer(): void {
    const defaultLayer: LayerInfo = {
      id: 'default',
      name: '图层 1',
      visible: true,
      locked: false,
      objects: []
    };
    
    this.layers.push(defaultLayer);
    this.activeLayerId = defaultLayer.id;
  }

  // 添加对象
  addObject(object: BaseObject, layerId?: string): void {
    const targetLayerId = layerId || this.activeLayerId;
    const layer = this.getLayer(targetLayerId);
    
    if (!layer) {
      throw new Error(`Layer ${targetLayerId} not found`);
    }

    if (layer.locked) {
      throw new Error(`Layer ${targetLayerId} is locked`);
    }

    // 添加到对象列表
    this.objects.push(object);
    
    // 添加到图层
    layer.objects.push(object);
    
    // 设置z-index
    (object as any).zIndex = this.zIndexCounter++;
    
    // 监听对象事件
    this.bindObjectEvents(object);
    
    this.emit('object:added', { object, layerId: targetLayerId });
  }

  // 移除对象
  removeObject(object: BaseObject): void {
    const objectIndex = this.objects.indexOf(object);
    if (objectIndex === -1) {
      return;
    }

    // 从对象列表移除
    this.objects.splice(objectIndex, 1);
    
    // 从图层移除
    for (const layer of this.layers) {
      const layerIndex = layer.objects.indexOf(object);
      if (layerIndex !== -1) {
        layer.objects.splice(layerIndex, 1);
        break;
      }
    }
    
    // 取消事件监听
    this.unbindObjectEvents(object);
    
    this.emit('object:removed', { object });
  }

  // 通过ID移除对象
  removeObjectById(id: string): void {
    const object = this.getObjectById(id);
    if (object) {
      this.removeObject(object);
    }
  }

  // 通过ID获取对象
  getObjectById(id: string): BaseObject | undefined {
    return this.objects.find(obj => obj.id === id);
  }

  // 获取所有对象
  getAllObjects(): BaseObject[] {
    return [...this.objects];
  }

  // 获取指定图层的对象
  getObjectsByLayer(layerId: string): BaseObject[] {
    const layer = this.getLayer(layerId);
    return layer ? [...layer.objects] : [];
  }

  // 获取可见对象
  getVisibleObjects(): BaseObject[] {
    return this.objects.filter(obj => {
      const layer = this.getObjectLayer(obj);
      return obj.visible && layer && layer.visible;
    });
  }

  // 获取可选择的对象
  getSelectableObjects(): BaseObject[] {
    return this.objects.filter(obj => {
      const layer = this.getObjectLayer(obj);
      return obj.selectable && layer && !layer.locked;
    });
  }

  // 点击测试 - 获取指定位置的对象
  hitTest(point: Point): BaseObject | null {
    const selectableObjects = this.getSelectableObjects();
    
    // 按z-index倒序遍历（从上到下）
    const sortedObjects = selectableObjects.sort((a, b) => 
      ((b as any).zIndex || 0) - ((a as any).zIndex || 0)
    );
    
    for (const object of sortedObjects) {
      if (object.hitTest(point)) {
        return object;
      }
    }
    
    return null;
  }

  // 区域选择 - 获取与指定区域相交的对象
  getObjectsInBounds(bounds: Bounds): BaseObject[] {
    return this.getSelectableObjects().filter(obj => {
      const objBounds = obj.getBounds();
      return this.boundsIntersect(bounds, objBounds);
    });
  }

  // 检查两个边界框是否相交
  private boundsIntersect(bounds1: Bounds, bounds2: Bounds): boolean {
    return !(
      bounds1.left > bounds2.left + bounds2.width ||
      bounds1.left + bounds1.width < bounds2.left ||
      bounds1.top > bounds2.top + bounds2.height ||
      bounds1.top + bounds1.height < bounds2.top
    );
  }

  // 对象层级管理
  bringToFront(object: BaseObject): void {
    (object as any).zIndex = this.zIndexCounter++;
    this.emit('object:z-order-changed', { object, action: 'front' });
  }

  sendToBack(object: BaseObject): void {
    (object as any).zIndex = -this.zIndexCounter--;
    this.emit('object:z-order-changed', { object, action: 'back' });
  }

  bringForward(object: BaseObject): void {
    (object as any).zIndex = ((object as any).zIndex || 0) + 1;
    this.emit('object:z-order-changed', { object, action: 'forward' });
  }

  sendBackward(object: BaseObject): void {
    (object as any).zIndex = ((object as any).zIndex || 0) - 1;
    this.emit('object:z-order-changed', { object, action: 'backward' });
  }

  // 图层管理
  createLayer(name: string): LayerInfo {
    const layer: LayerInfo = {
      id: `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      visible: true,
      locked: false,
      objects: []
    };
    
    this.layers.push(layer);
    this.emit('layer:created', { layer });
    
    return layer;
  }

  removeLayer(layerId: string): void {
    if (layerId === 'default') {
      throw new Error('Cannot remove default layer');
    }

    const layerIndex = this.layers.findIndex(layer => layer.id === layerId);
    if (layerIndex === -1) {
      return;
    }

    const layer = this.layers[layerIndex];
    
    // 移除图层中的所有对象
    const objectsToRemove = [...layer.objects];
    objectsToRemove.forEach(obj => this.removeObject(obj));
    
    // 移除图层
    this.layers.splice(layerIndex, 1);
    
    // 如果删除的是当前活动图层，切换到默认图层
    if (this.activeLayerId === layerId) {
      this.activeLayerId = 'default';
    }
    
    this.emit('layer:removed', { layerId });
  }

  getLayer(layerId: string): LayerInfo | undefined {
    return this.layers.find(layer => layer.id === layerId);
  }

  getAllLayers(): LayerInfo[] {
    return [...this.layers];
  }

  setActiveLayer(layerId: string): void {
    const layer = this.getLayer(layerId);
    if (!layer) {
      throw new Error(`Layer ${layerId} not found`);
    }

    this.activeLayerId = layerId;
    this.emit('layer:active-changed', { layerId });
  }

  getActiveLayer(): LayerInfo | undefined {
    return this.getLayer(this.activeLayerId);
  }

  // 设置图层属性
  setLayerVisible(layerId: string, visible: boolean): void {
    const layer = this.getLayer(layerId);
    if (layer) {
      layer.visible = visible;
      this.emit('layer:visibility-changed', { layerId, visible });
    }
  }

  setLayerLocked(layerId: string, locked: boolean): void {
    const layer = this.getLayer(layerId);
    if (layer) {
      layer.locked = locked;
      this.emit('layer:lock-changed', { layerId, locked });
    }
  }

  setLayerName(layerId: string, name: string): void {
    const layer = this.getLayer(layerId);
    if (layer) {
      layer.name = name;
      this.emit('layer:name-changed', { layerId, name });
    }
  }

  // 移动对象到指定图层
  moveObjectToLayer(object: BaseObject, targetLayerId: string): void {
    const currentLayer = this.getObjectLayer(object);
    const targetLayer = this.getLayer(targetLayerId);
    
    if (!currentLayer || !targetLayer) {
      return;
    }

    if (targetLayer.locked) {
      throw new Error(`Target layer ${targetLayerId} is locked`);
    }

    // 从当前图层移除
    const currentIndex = currentLayer.objects.indexOf(object);
    if (currentIndex !== -1) {
      currentLayer.objects.splice(currentIndex, 1);
    }

    // 添加到目标图层
    targetLayer.objects.push(object);
    
    this.emit('object:layer-changed', { 
      object, 
      fromLayerId: currentLayer.id, 
      toLayerId: targetLayerId 
    });
  }

  // 获取对象所在的图层
  getObjectLayer(object: BaseObject): LayerInfo | undefined {
    return this.layers.find(layer => layer.objects.includes(object));
  }

  // 清空所有对象
  clear(): void {
    const objectsToRemove = [...this.objects];
    objectsToRemove.forEach(obj => this.removeObject(obj));
    
    // 重置图层
    this.layers.forEach(layer => {
      layer.objects = [];
    });
    
    this.emit('objects:cleared');
  }

  // 绑定对象事件
  private bindObjectEvents(object: BaseObject): void {
    const forwardEvent = (eventType: string) => (event: any) => {
      this.emit(eventType, event);
    };

    object.on('object:moved', forwardEvent('object:moved'));
    object.on('object:scaled', forwardEvent('object:scaled'));
    object.on('object:rotated', forwardEvent('object:rotated'));
    object.on('object:resized', forwardEvent('object:resized'));
  }

  // 取消对象事件绑定
  private unbindObjectEvents(object: BaseObject): void {
    object.removeAllListeners();
  }

  // 渲染所有对象
  renderAll(ctx: CanvasRenderingContext2D): void {
    // 按图层顺序渲染
    for (const layer of this.layers) {
      if (!layer.visible) {
        continue;
      }

      // 按z-index排序
      const sortedObjects = layer.objects
        .filter(obj => obj.visible)
        .sort((a, b) => ((a as any).zIndex || 0) - ((b as any).zIndex || 0));

      for (const object of sortedObjects) {
        try {
          object.render(ctx);
        } catch (error) {
          console.error('Error rendering object:', object.id, error);
        }
      }
    }
  }

  // 获取对象数量统计
  getStats(): {
    totalObjects: number;
    visibleObjects: number;
    selectableObjects: number;
    layerCount: number;
  } {
    return {
      totalObjects: this.objects.length,
      visibleObjects: this.getVisibleObjects().length,
      selectableObjects: this.getSelectableObjects().length,
      layerCount: this.layers.length
    };
  }

  // 导出为JSON
  toJSON(): any {
    return {
      objects: this.objects.map(obj => obj.toJSON()),
      layers: this.layers.map(layer => ({
        ...layer,
        objects: layer.objects.map(obj => obj.id)
      })),
      activeLayerId: this.activeLayerId
    };
  }

  // 从JSON导入
  fromJSON(data: any): void {
    this.clear();
    
    // 这里需要对象工厂来创建具体的对象实例
    // 暂时留空，需要在编辑器主类中实现
  }
}