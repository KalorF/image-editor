// oxlint-disable filename-case
import type { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { EditorHooks, type Plugin } from '../types';

export class ResizeZoomPlugin implements Plugin<Editor> {
  name = 'resizeZoom';
  version = '1.0.0';

  private editor!: Editor;

  install(editor: Editor): void {
    this.editor = editor;
    editor.hooks.before(EditorHooks.RESIZE_CANVAS, this.resizeCanvas.bind(this));
  }

  uninstall(editor: Editor): void {
    editor.hooks.removeHook(EditorHooks.RESIZE_CANVAS, this.resizeCanvas);
  }

  /**
   * 重置画布大小
   * @param _ctx 画布上下文
   */
  private resizeCanvas(_ctx: CanvasRenderingContext2D): void {
    const allObjects = this.editor.objectManager.getAllObjects();
    for (const obj of allObjects) {
      if (obj.type === 'image') {
        const scale = this.editor.scaleImageToFit(obj as ImageObject);
        const screenCenter = {
          x: this.editor.viewport.width / 2,
          y: this.editor.viewport.height / 2,
        };
        const worldCenter = this.editor.viewport.screenToWorld(screenCenter);
        obj.setPosition(worldCenter.x, worldCenter.y);
        if (this.editor.history) {
          this.editor.history?.setAllHistoryObjectTransform({
            x: worldCenter.x,
            y: worldCenter.y,
            scaleX: scale,
            scaleY: scale,
            rotation: 0,
          });
        }
      }
    }
  }
}
