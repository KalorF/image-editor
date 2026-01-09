/**
 * 事件发射器类
 * 提供类型安全的事件订阅、发布和取消订阅功能
 */

// 事件处理函数类型
type EventHandler<T = any> = (event: T) => void;

// 事件映射类型
type EventMap = Record<string | symbol, any>;

// 通配符事件处理函数
type WildcardHandler<T = EventMap> = (type: keyof T, event: T[keyof T]) => void;

// 处理函数列表类型
type EventHandlerList<T = any> = Array<EventHandler<T>>;
type WildcardHandlerList<T = EventMap> = Array<WildcardHandler<T>>;

/**
 * 事件发射器类
 * @template Events 事件映射类型，定义事件名称和对应的数据类型
 */
class EventEmitter<Events extends EventMap = EventMap> {
  // 事件处理函数映射表
  private readonly handlers = new Map<keyof Events, EventHandlerList<Events[keyof Events]>>();

  // 通配符事件处理函数列表
  private readonly wildcardHandlers: WildcardHandlerList<Events> = [];

  /**
   * 订阅事件
   * @param type 事件类型
   * @param handler 事件处理函数
   */
  on<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): void;
  on(type: '*', handler: WildcardHandler<Events>): void;
  on<Key extends keyof Events>(
    type: Key | '*',
    handler: EventHandler<Events[Key]> | WildcardHandler<Events>,
  ): void {
    if (type === '*') {
      this.wildcardHandlers.push(handler as WildcardHandler<Events>);
    } else {
      const existingHandlers = this.handlers.get(type as keyof Events);
      if (existingHandlers) {
        (existingHandlers as EventHandlerList<Events[Key]>).push(
          handler as EventHandler<Events[Key]>,
        );
      } else {
        this.handlers.set(
          type as keyof Events,
          [handler as EventHandler<Events[Key]>] as EventHandlerList<Events[keyof Events]>,
        );
      }
    }
  }

  /**
   * 取消订阅事件
   * @param type 事件类型
   * @param handler 要移除的事件处理函数（可选）
   */
  off<Key extends keyof Events>(type: Key, handler?: EventHandler<Events[Key]>): void;
  off(type: '*', handler?: WildcardHandler<Events>): void;
  off<Key extends keyof Events>(
    type: Key | '*',
    handler?: EventHandler<Events[Key]> | WildcardHandler<Events>,
  ): void {
    if (type === '*') {
      if (handler) {
        const index = this.wildcardHandlers.indexOf(handler as WildcardHandler<Events>);
        if (index > -1) {
          this.wildcardHandlers.splice(index, 1);
        }
      } else {
        this.wildcardHandlers.length = 0;
      }
    } else {
      const handlers = this.handlers.get(type);
      if (handlers) {
        if (handler) {
          const typedHandlers = handlers as EventHandlerList<Events[Key]>;
          const index = typedHandlers.indexOf(handler as EventHandler<Events[Key]>);
          if (index > -1) {
            typedHandlers.splice(index, 1);
          }
        } else {
          this.handlers.delete(type);
        }
      }
    }
  }

  /**
   * 发射事件
   * @param type 事件类型
   * @param event 事件数据
   */
  emit<Key extends keyof Events>(type: Key, event: Events[Key]): void;
  emit<Key extends keyof Events>(type: undefined extends Events[Key] ? Key : never): void;
  emit<Key extends keyof Events>(type: Key, event?: Events[Key]): void {
    // 触发指定类型的事件处理函数
    const handlers = this.handlers.get(type);
    if (handlers) {
      // 使用 slice() 创建副本，避免在执行过程中修改原数组
      handlers.slice().forEach(handler => {
        try {
          handler(event!);
        } catch (error) {
          // 错误处理：避免单个处理函数的错误影响其他处理函数
          console.error(`Error in event handler for "${String(type)}":`, error);
        }
      });
    }

    // 触发通配符事件处理函数
    if (this.wildcardHandlers.length > 0) {
      this.wildcardHandlers.slice().forEach(handler => {
        try {
          handler(type, event!);
        } catch (error) {
          console.error(`Error in wildcard handler for "${String(type)}":`, error);
        }
      });
    }
  }

  /**
   * 一次性事件订阅
   * @param type 事件类型
   * @param handler 事件处理函数
   */
  once<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): void {
    const onceHandler = (event: Events[Key]) => {
      this.off(type, onceHandler);
      handler(event);
    };
    this.on(type, onceHandler);
  }

  /**
   * 清除所有事件监听器
   */
  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcardHandlers.length = 0;
  }
}

export default EventEmitter;
