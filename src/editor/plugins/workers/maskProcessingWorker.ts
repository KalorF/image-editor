// packages/apps/project/src/services/bitmap-editor/plugins/workers/maskProcessingWorker.ts

interface MaskProcessMessage {
  kind: 'convertToTransparent' | 'convertToColor' | 'detectOverlap' | 'getOffscreenCanvas';
  jobId: number;
  width: number;
  height: number;
  data: Uint8ClampedArray | OffscreenCanvas;
  // 针对不同任务的参数
  color?: string; // convertToColor 使用
  maskData2?: Uint8ClampedArray; // detectOverlap 使用
}

interface MaskProcessResultMessage {
  kind: 'maskProcess:result';
  jobId: number;
  taskType: string;
  width: number;
  height: number;
  result: Uint8ClampedArray | boolean | ImageData; // 根据任务类型返回不同结果
}

self.onmessage = (e: MessageEvent<MaskProcessMessage>) => {
  const msg = e.data;
  try {
    let result: Uint8ClampedArray | boolean | ImageData;

    switch (msg.kind) {
      case 'convertToTransparent':
        result = convertMaskToTransparentWorker(
          msg.data as Uint8ClampedArray,
          msg.width,
          msg.height,
        );
        break;
      case 'convertToColor':
        result = convertMaskToColorWorker(
          msg.data as Uint8ClampedArray,
          msg.width,
          msg.height,
          msg.color!,
        );
        break;
      case 'detectOverlap':
        result = detectPixelOverlapWorker(
          msg.data as Uint8ClampedArray,
          msg.maskData2!,
          msg.width,
          msg.height,
        );
        break;
      case 'getOffscreenCanvas':
        result = getOffscreenCanvasWorker(msg.data as unknown as OffscreenCanvas);
        break;
      default:
        throw new Error(`Unknown task: ${msg.kind}`);
    }

    const out: MaskProcessResultMessage = {
      kind: 'maskProcess:result',
      jobId: msg.jobId,
      taskType: msg.kind,
      width: msg.width,
      height: msg.height,
      result,
    };

    // 使用 Transferable Objects 优化传输
    if (result instanceof Uint8ClampedArray) {
      (self as any).postMessage(out, [result.buffer]);
    } else {
      (self as any).postMessage(out);
    }
  } catch (_error) {
    // 错误处理...
  }
};

function getOffscreenCanvasWorker(data: OffscreenCanvas): ImageData {
  const canvas = data;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Worker 版本的函数实现
function convertMaskToTransparentWorker(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
): Uint8ClampedArray {
  const result = data.slice();
  const data32 = new Uint32Array(result.buffer);
  const len32 = data32.length;

  for (let i = 0; i < len32; i++) {
    const pixel = data32[i];
    const r = pixel & 0xff;
    const g = (pixel >> 8) & 0xff;
    const b = (pixel >> 16) & 0xff;
    const brightness = (r + g + b) / 3;
    data32[i] = (brightness << 24) | (pixel & 0x00ffffff);
  }

  return result;
}

function convertMaskToColorWorker(
  data: Uint8ClampedArray,
  _width: number,
  _height: number,
  colorHex: string,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  const rgb = hexToRgbWorker(colorHex);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 0) {
      result[i] = rgb.r;
      result[i + 1] = rgb.g;
      result[i + 2] = rgb.b;
      result[i + 3] = 255;
    }
  }

  return result;
}

function detectPixelOverlapWorker(
  maskData1: Uint8ClampedArray,
  maskData2: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha1 = maskData1[index + 3];
      const alpha2 = maskData2[index + 3];

      if (alpha2 > 10 && alpha1 <= 10) {
        return false;
      }
    }
  }
  return true;
}

function hexToRgbWorker(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 255, g: 0, b: 0 };
}
