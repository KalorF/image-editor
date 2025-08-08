// 钩子管理器
import type { HookCallback } from '../types';

interface Hook {
  callback: HookCallback;
  priority: number;
}

export class HookManager {
  private beforeHooks: Map<string, Hook[]> = new Map();
  private afterHooks: Map<string, Hook[]> = new Map();

  // 注册前置钩子
  before(hookName: string, callback: HookCallback, priority: number = 0): void {
    this.addHook(this.beforeHooks, hookName, callback, priority);
  }

  // 注册后置钩子
  after(hookName: string, callback: HookCallback, priority: number = 0): void {
    this.addHook(this.afterHooks, hookName, callback, priority);
  }

  // 添加钩子
  private addHook(
    hookMap: Map<string, Hook[]>, 
    hookName: string, 
    callback: HookCallback, 
    priority: number
  ): void {
    if (!hookMap.has(hookName)) {
      hookMap.set(hookName, []);
    }

    const hooks = hookMap.get(hookName)!;
    hooks.push({ callback, priority });
    
    // 按优先级排序（数字越大优先级越高）
    hooks.sort((a, b) => b.priority - a.priority);
  }

  // 移除钩子
  removeHook(hookName: string, callback: HookCallback, type: 'before' | 'after' = 'before'): void {
    const hookMap = type === 'before' ? this.beforeHooks : this.afterHooks;
    
    if (!hookMap.has(hookName)) {
      return;
    }

    const hooks = hookMap.get(hookName)!;
    const index = hooks.findIndex(hook => hook.callback === callback);
    
    if (index !== -1) {
      hooks.splice(index, 1);
    }

    if (hooks.length === 0) {
      hookMap.delete(hookName);
    }
  }

  // 触发钩子
  trigger(hookName: string, ...args: any[]): {
    beforeResults: any[];
    afterResults: any[];
  } {
    const beforeResults = this.executeHooks(this.beforeHooks, hookName, ...args);
    const afterResults = this.executeHooks(this.afterHooks, hookName, ...args);
    
    return { beforeResults, afterResults };
  }

  // 执行钩子
  private executeHooks(hookMap: Map<string, Hook[]>, hookName: string, ...args: any[]): any[] {
    const hooks = hookMap.get(hookName);
    if (!hooks || hooks.length === 0) {
      return [];
    }

    const results: any[] = [];
    
    for (const hook of hooks) {
      try {
        const result = hook.callback(...args);
        results.push(result);
        
        // 如果钩子返回false，停止执行后续钩子
        if (result === false) {
          break;
        }
      } catch (error) {
        console.error(`Error in hook ${hookName}:`, error);
      }
    }

    return results;
  }

  // 检查是否存在钩子
  hasHook(hookName: string, type?: 'before' | 'after'): boolean {
    if (type) {
      const hookMap = type === 'before' ? this.beforeHooks : this.afterHooks;
      return hookMap.has(hookName) && hookMap.get(hookName)!.length > 0;
    }

    return this.hasHook(hookName, 'before') || this.hasHook(hookName, 'after');
  }

  // 获取所有钩子名称
  getHookNames(): string[] {
    const beforeNames = Array.from(this.beforeHooks.keys());
    const afterNames = Array.from(this.afterHooks.keys());
    return [...new Set([...beforeNames, ...afterNames])];
  }

  // 清除所有钩子
  clear(): void {
    this.beforeHooks.clear();
    this.afterHooks.clear();
  }

  // 清除指定钩子
  clearHook(hookName: string): void {
    this.beforeHooks.delete(hookName);
    this.afterHooks.delete(hookName);
  }
}