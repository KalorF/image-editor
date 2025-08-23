// 插件管理器
import type { Plugin } from '../types';
import { EditorEvents } from '../types';
import { EventEmitter } from './EventEmitter';

export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin<any>> = new Map();
  private installedPlugins: Set<string> = new Set();

  private editor: any;

  constructor(editor: any) {
    super();
    this.editor = editor;
  }

  // 注册插件
  register(plugin: Plugin<any>): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered`);
      return;
    }

    this.plugins.set(plugin.name, plugin);
    this.emit(EditorEvents.PLUGIN_REGISTERED, { plugin });
  }

  // 安装插件
  install(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not registered`);
    }

    if (this.installedPlugins.has(pluginName)) {
      console.warn(`Plugin ${pluginName} is already installed`);
      return;
    }

    try {
      // 触发安装前钩子
      this.emit(EditorEvents.PLUGIN_BEFORE_INSTALL, { plugin, editor: this.editor });

      // 安装插件
      plugin.install(this.editor);
      this.installedPlugins.add(pluginName);

      // 触发安装后钩子
      this.emit(EditorEvents.PLUGIN_INSTALLED, { plugin, editor: this.editor });

      console.log(`Plugin ${pluginName} installed successfully`);
    } catch (error) {
      console.error(`Failed to install plugin ${pluginName}:`, error);
      throw error;
    }
  }

  // 卸载插件
  uninstall(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not registered`);
    }

    if (!this.installedPlugins.has(pluginName)) {
      console.warn(`Plugin ${pluginName} is not installed`);
      return;
    }

    try {
      // 触发卸载前钩子
      this.emit(EditorEvents.PLUGIN_BEFORE_UNINSTALL, { plugin, editor: this.editor });

      // 卸载插件
      if (plugin.uninstall) {
        plugin.uninstall(this.editor);
      }
      this.installedPlugins.delete(pluginName);

      // 触发卸载后钩子
      this.emit(EditorEvents.PLUGIN_UNINSTALLED, { plugin, editor: this.editor });

      console.log(`Plugin ${pluginName} uninstalled successfully`);
    } catch (error) {
      console.error(`Failed to uninstall plugin ${pluginName}:`, error);
      throw error;
    }
  }

  // 一次性注册并安装插件
  use(plugin: Plugin): void {
    this.register(plugin);
    this.install(plugin.name);
  }

  // 检查插件是否已注册
  isRegistered(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  // 检查插件是否已安装
  isInstalled(pluginName: string): boolean {
    return this.installedPlugins.has(pluginName);
  }

  // 获取插件信息
  getPlugin(pluginName: string): Plugin | undefined {
    return this.plugins.get(pluginName);
  }

  // 获取所有已注册的插件
  getRegisteredPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  // 获取所有已安装的插件
  getInstalledPlugins(): Plugin[] {
    return Array.from(this.installedPlugins)
      .map(name => this.plugins.get(name))
      .filter(Boolean) as Plugin[];
  }

  // 获取插件状态
  getPluginStatus(): Record<
    string,
    {
      registered: boolean;
      installed: boolean;
      version: string;
    }
  > {
    const status: Record<string, any> = {};

    this.plugins.forEach((plugin, name) => {
      status[name] = {
        registered: true,
        installed: this.installedPlugins.has(name),
        version: plugin.version,
      };
    });

    return status;
  }

  // 卸载所有插件
  uninstallAll(): void {
    const installedPluginNames = Array.from(this.installedPlugins);
    installedPluginNames.forEach(name => {
      try {
        this.uninstall(name);
      } catch (error) {
        console.error(`Failed to uninstall plugin ${name}:`, error);
      }
    });
  }

  // 清除所有插件（注册和安装状态）
  clear(): void {
    this.uninstallAll();
    this.plugins.clear();
    this.installedPlugins.clear();
  }
}
