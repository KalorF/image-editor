// 事件发射器类
import type { EditorEvent, EventHandler } from '../types';

export class EventEmitter {
  private listeners: Map<string, EventHandler[]> = new Map();

  // 添加事件监听器
  on(eventType: string, handler: EventHandler): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(handler);
  }

  // 移除事件监听器
  off(eventType: string, handler?: EventHandler): void {
    if (!this.listeners.has(eventType)) {
      return;
    }

    if (!handler) {
      // 移除所有该类型的监听器
      this.listeners.delete(eventType);
      return;
    }

    const handlers = this.listeners.get(eventType)!;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }

    if (handlers.length === 0) {
      this.listeners.delete(eventType);
    }
  }

  // 添加一次性事件监听器
  once(eventType: string, handler: EventHandler): void {
    const onceHandler: EventHandler = (event: EditorEvent) => {
      handler(event);
      this.off(eventType, onceHandler);
    };
    this.on(eventType, onceHandler);
  }

  // 触发事件
  emit(eventType: string, data?: any, target?: any, originalEvent?: Event): void {
    if (!this.listeners.has(eventType)) {
      return;
    }

    const event: EditorEvent = {
      type: eventType,
      data,
      target,
      originalEvent
    };

    const handlers = this.listeners.get(eventType)!.slice(); // 复制数组避免修改问题
    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    });
  }

  // 获取所有事件类型
  getEventTypes(): string[] {
    return Array.from(this.listeners.keys());
  }

  // 获取指定事件的监听器数量
  getListenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.length || 0;
  }

  // 清除所有监听器
  removeAllListeners(): void {
    this.listeners.clear();
  }
}