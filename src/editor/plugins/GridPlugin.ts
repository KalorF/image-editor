// 网格插件 - 显示网格背景
import type { Editor } from '../Editor';
import type { Plugin } from '../types';
import { EditorHooks } from '../types';

export interface GridPluginOptions {
  size?: number;
  color?: string;
  opacity?: number;
  enabled?: boolean;
  // 棋盘格模式配置
  checkerboard?: boolean;
  checkerboardColor1?: string; // 棋盘格第一种颜色
  checkerboardColor2?: string; // 棋盘格第二种颜色
  showShadow?: boolean;
  shadowColor?: string;
}

export class GridPlugin implements Plugin<Editor> {
  name = 'grid';
  version = '1.0.0';

  private editor!: Editor;
  private options: GridPluginOptions;

  constructor(options: GridPluginOptions = {}) {
    this.options = {
      size: 20,
      color: '#E0E0E0',
      opacity: 1,
      enabled: true,
      checkerboard: false,
      checkerboardColor1: '#ffffff', // 浅灰色
      checkerboardColor2: '#ebebeb', // 深灰色
      showShadow: false,
      shadowColor: 'rgba(0, 0, 0, 0.4)',
      ...options,
    };
  }

  install(editor: Editor): void {
    this.editor = editor;
    editor.hooks.before(EditorHooks.RENDER_BEFORE, this.renderGrid.bind(this), 100);
  }

  uninstall(editor: Editor): void {
    // 移除钩子
    editor.hooks.removeHook(EditorHooks.RENDER_BEFORE, this.renderGrid);
  }

  private renderGrid(ctx: CanvasRenderingContext2D): void {
    if (!this.options.enabled) {
      return;
    }

    const viewport = this.editor.viewport;
    const baseGridSize = this.options.size!;
    const devicePixelRatio = window.devicePixelRatio || 1;

    // 保存当前变换状态
    ctx.save();

    // 重置到屏幕坐标系，直接在屏幕空间绘制网格
    ctx.resetTransform();

    // 获取canvas的实际显示尺寸（考虑DPR）
    const canvasWidth = viewport.width * devicePixelRatio;
    const canvasHeight = viewport.height * devicePixelRatio;

    // 计算实际网格间距（在屏幕像素中）
    const gridSpacing = baseGridSize * devicePixelRatio;

    // 计算网格偏移，使网格跟随视口移动
    const offsetX = 0;
    const offsetY = 0;

    if (this.options.checkerboard) {
      // 棋盘格模式
      this.renderCheckerboard(ctx, canvasWidth, canvasHeight, gridSpacing, offsetX, offsetY);
    } else {
      // 普通线条网格模式
      this.renderLineGrid(ctx, canvasWidth, canvasHeight, gridSpacing, offsetX, offsetY);
    }

    // 恢复变换状态
    ctx.restore();
  }

  private renderLineGrid(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    gridSpacing: number,
    offsetX: number,
    offsetY: number,
  ): void {
    const devicePixelRatio = window.devicePixelRatio || 1;

    // 设置网格样式
    ctx.strokeStyle = this.options.color!;
    ctx.globalAlpha = this.options.opacity!;
    ctx.lineWidth = devicePixelRatio; // 在高DPR下保持1像素线宽

    ctx.beginPath();

    // 绘制垂直线，确保覆盖整个画布
    for (let x = offsetX; x <= canvasWidth + gridSpacing; x += gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }
    for (let x = offsetX - gridSpacing; x >= -gridSpacing; x -= gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }

    // 绘制水平线，确保覆盖整个画布
    for (let y = offsetY; y <= canvasHeight + gridSpacing; y += gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
    for (let y = offsetY - gridSpacing; y >= -gridSpacing; y -= gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
    ctx.stroke();
    if (this.options.showShadow) {
      ctx.fillStyle = this.options.shadowColor!;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
  }

  private renderCheckerboard(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    gridSpacing: number,
    offsetX: number,
    offsetY: number,
  ): void {
    // 设置透明度
    ctx.globalAlpha = this.options.opacity!;

    // 计算需要绘制的网格范围
    const startX = Math.floor(-offsetX / gridSpacing) * gridSpacing + offsetX;
    const startY = Math.floor(-offsetY / gridSpacing) * gridSpacing + offsetY;

    // 绘制棋盘格
    let rowIndex = Math.floor(-offsetY / gridSpacing);
    for (let y = startY; y < canvasHeight + gridSpacing; y += gridSpacing, rowIndex++) {
      let colIndex = Math.floor(-offsetX / gridSpacing);
      for (let x = startX; x < canvasWidth + gridSpacing; x += gridSpacing, colIndex++) {
        // 棋盘格交错模式：(行索引 + 列索引) 为偶数时使用第一种颜色，奇数时使用第二种颜色
        const isEven = (rowIndex + colIndex) % 2 === 0;
        ctx.fillStyle = isEven
          ? this.options.checkerboardColor1!
          : this.options.checkerboardColor2!;

        // 绘制矩形块
        ctx.fillRect(x, y, gridSpacing, gridSpacing);
      }
    }
    if (this.options.showShadow) {
      ctx.fillStyle = this.options.shadowColor!;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
  }

  show(): void {
    this.options.enabled = true;
    this.editor.requestRender();
  }

  hide(): void {
    this.options.enabled = false;
    this.editor.requestRender();
  }

  setSize(size: number): void {
    this.options.size = Math.max(1, size);
    this.editor.requestRender();
  }

  setColor(color: string): void {
    this.options.color = color;
    this.editor.requestRender();
  }

  setOpacity(opacity: number): void {
    this.options.opacity = Math.max(0, Math.min(1, opacity));
    this.editor.requestRender();
  }

  enableCheckerboard(): void {
    this.options.checkerboard = true;
    this.editor.requestRender();
  }

  disableCheckerboard(): void {
    this.options.checkerboard = false;
    this.editor.requestRender();
  }

  setCheckerboardColors(color1: string, color2: string): void {
    this.options.checkerboardColor1 = color1;
    this.options.checkerboardColor2 = color2;
    this.editor.requestRender();
  }
}
