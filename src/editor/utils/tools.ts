export const loadImage = async (src: string) => {
  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.src = src;
  return new Promise((resolve, reject) => {
    img.onload = () => {
      resolve(img);
    };
    img.onerror = reject;
  });
};

/**
 * 检查两个canvas是否有重叠的像素
 * @param canvas1
 * @param canvas2
 * @param threshold
 * @returns
 */
export function hasOverlappingPixels(
  canvas1: HTMLCanvasElement,
  canvas2: HTMLCanvasElement,
  threshold: number = 0,
): boolean {
  const ctx1 = canvas1.getContext('2d');
  const ctx2 = canvas2.getContext('2d');

  if (!ctx1 || !ctx2) return false;

  // 确保两个 canvas 尺寸相同
  if (canvas1.width !== canvas2.width || canvas1.height !== canvas2.height) {
    console.warn('Canvas dimensions do not match');
    return false;
  }

  const width = canvas1.width;
  const height = canvas1.height;

  // 获取像素数据
  const imageData1 = ctx1.getImageData(0, 0, width, height);
  const imageData2 = ctx2.getImageData(0, 0, width, height);

  const data1 = imageData1.data;
  const data2 = imageData2.data;

  // 检查每个像素
  for (let i = 0; i < data1.length; i += 4) {
    const alpha1 = data1[i + 3]; // canvas1 的 alpha 通道
    const alpha2 = data2[i + 3]; // canvas2 的 alpha 通道

    // 如果两个位置的像素都不透明（都大于阈值），则有重叠
    if (alpha1 > threshold && alpha2 > threshold) {
      return true;
    }
  }

  return false; // 没有重叠
}
