// oxlint-disable-next-line filename-case
import { Editor } from '../Editor';
import { ImageObject } from '../objects/ImageObject';
import { type Plugin } from '../types';

export class PreviewMaskPlugin implements Plugin<Editor> {
  name = 'previewMask';
  version = '1.0.0';

  private editor!: Editor;

  install(editor: Editor): void {
    this.editor = editor;
  }

  setPreviewMask(isPreviewMask: boolean): void {
    this.editor.objectManager.getAllObjects().forEach(obj => {
      if (obj.type === 'image') {
        (obj as ImageObject).setPreviewMask(isPreviewMask);
      }
    });
    this.editor.toggleDisableAllTools(isPreviewMask);
    this.editor.requestRender();
  }
}
