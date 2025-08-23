// oxlint-disable no-unsafe-function-type
// 事件发射器类
import type {
  AllEventMap,
  EditorEvent,
  EventHandler,
  ImageEditorEventType,
  TypedEventEmitter,
} from '../types';

export class EventEmitter implements TypedEventEmitter {
  private listeners: Map<string, Function[]> = new Map();

  // 类型安全的添加事件监听器
  on<K extends ImageEditorEventType>(
    eventType: K,
    handler: (data: AllEventMap[K], target?: any, originalEvent?: Event) => void,
  ): void;
  // 向后兼容的重载
  on(eventType: string, handler: EventHandler): void;
  on(eventType: string, handler: Function): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(handler);
  }

  // 类型安全的移除事件监听器
  off<K extends ImageEditorEventType>(
    eventType: K,
    handler?: (data: AllEventMap[K], target?: any, originalEvent?: Event) => void,
  ): void;
  // 向后兼容的重载
  off(eventType: string, handler?: EventHandler): void;
  off(eventType: string, handler?: Function): void {
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
  once<K extends ImageEditorEventType>(
    eventType: K,
    handler: (data: AllEventMap[K], target?: any, originalEvent?: Event) => void,
  ): void;
  // 向后兼容的重载
  once(eventType: string, handler: EventHandler): void;
  once(eventType: string, handler: Function): void {
    const onceHandler = (...args: any[]) => {
      handler(...args);
      this.off(eventType, onceHandler);
    };
    this.on(eventType, onceHandler);
  }

  // 类型安全的触发事件
  emit<K extends ImageEditorEventType>(
    eventType: K,
    data: AllEventMap[K],
    target?: any,
    originalEvent?: Event,
  ): void;
  // 向后兼容的重载
  emit(eventType: string, data?: any, target?: any, originalEvent?: Event): void;
  emit(eventType: string, data?: any, target?: any, originalEvent?: Event): void {
    if (!this.listeners.has(eventType)) {
      return;
    }

    const handlers = this.listeners.get(eventType)!.slice(); // 复制数组避免修改问题

    // 针对新的类型安全模式，直接传递data、target、originalEvent
    // 针对旧的EditorEvent模式，包装为EditorEvent对象
    handlers.forEach(handler => {
      try {
        // 检查handler的参数长度来判断是新版本还是旧版本
        if (handler.length <= 3) {
          // 新版本：直接传递参数
          handler(data, target, originalEvent);
        } else {
          // 旧版本：包装为EditorEvent
          const event: EditorEvent = {
            type: eventType,
            data,
            target,
            originalEvent,
          };
          handler(event);
        }
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
