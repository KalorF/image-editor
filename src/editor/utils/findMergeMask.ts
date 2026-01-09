// 辅助函数：将ImageData转换为二维数组
function imageDataToArray(imageData: ImageData): number[][] {
  const { width, height, data } = imageData;
  const array: number[][] = [];

  for (let y = 0; y < height; y++) {
    array[y] = [];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      // 假设使用红色通道来表示mask值（0或255）
      array[y][x] = data[index] > 127 ? 1 : 0;
    }
  }
  return array;
}

// 辅助函数：将二维数组转换为ImageData
function arrayToImageData(array: number[][], width: number, height: number): ImageData {
  const imageData = new ImageData(width, height);
  const { data } = imageData;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = array[y][x] * 255;
      data[index] = value; // R
      data[index + 1] = value; // G
      data[index + 2] = value; // B
      data[index + 3] = 255; // A
    }
  }
  return imageData;
}

// 连通域标记函数
function labelConnectedComponents(mask: boolean[][]): { labeled: number[][]; numFeatures: number } {
  const height = mask.length;
  const width = mask[0].length;
  const labeled: number[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(0));
  let currentLabel = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x] && labeled[y][x] === 0) {
        // BFS 标记连通区域
        const queue: [number, number][] = [[y, x]];
        labeled[y][x] = currentLabel;

        while (queue.length > 0) {
          const [cy, cx] = queue.shift()!;

          // 检查4连通邻域
          const neighbors = [
            [cy - 1, cx],
            [cy + 1, cx],
            [cy, cx - 1],
            [cy, cx + 1],
          ];

          for (const [ny, nx] of neighbors) {
            if (
              ny >= 0 &&
              ny < height &&
              nx >= 0 &&
              nx < width &&
              mask[ny][nx] &&
              labeled[ny][nx] === 0
            ) {
              labeled[ny][nx] = currentLabel;
              queue.push([ny, nx]);
            }
          }
        }
        currentLabel++;
      }
    }
  }

  return { labeled, numFeatures: currentLabel - 1 };
}

// 计算洞区域
function computeHoleMask(binaryMask: number[][]): boolean[][] {
  const height = binaryMask.length;
  const width = binaryMask[0].length;

  // 创建反向mask（0变1，1变0）
  const maskInv = binaryMask.map(row => row.map(val => val === 0));

  // 标记连通区域
  const { labeled, numFeatures } = labelConnectedComponents(maskInv);

  // 找到与边界连通的标签
  const borderLabels = new Set<number>();

  // 顶部和底部边界
  for (let x = 0; x < width; x++) {
    borderLabels.add(labeled[0][x]);
    borderLabels.add(labeled[height - 1][x]);
  }

  // 左侧和右侧边界
  for (let y = 0; y < height; y++) {
    borderLabels.add(labeled[y][0]);
    borderLabels.add(labeled[y][width - 1]);
  }

  // 创建洞mask
  const holeMask: boolean[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(false));

  for (let regionLabel = 1; regionLabel <= numFeatures; regionLabel++) {
    if (!borderLabels.has(regionLabel)) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (labeled[y][x] === regionLabel) {
            holeMask[y][x] = true;
          }
        }
      }
    }
  }

  return holeMask;
}

// 按连通域大小清理，返回布尔mask
function cleanByRegionSizeBool(maskBool: boolean[][], minRegionSize: number): boolean[][] {
  const { labeled, numFeatures } = labelConnectedComponents(maskBool);
  const height = maskBool.length;
  const width = maskBool[0].length;
  const cleaned: boolean[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(false));

  for (let regionLabel = 1; regionLabel <= numFeatures; regionLabel++) {
    // 计算区域大小
    let regionSize = 0;
    const regionPixels: [number, number][] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (labeled[y][x] === regionLabel) {
          regionSize++;
          regionPixels.push([y, x]);
        }
      }
    }

    // 如果区域大小满足条件，保留该区域
    if (regionSize >= minRegionSize) {
      for (const [y, x] of regionPixels) {
        cleaned[y][x] = true;
      }
    }
  }

  return cleaned;
}

// 按区域和连通域过滤mask
function filterMaskByAreaAndRegion(
  mask: number[][],
  minArea: number,
  minRegionSize: number,
): number[][] | null {
  const maskBool = mask.map(row => row.map(val => val > 0));
  const cleaned = cleanByRegionSizeBool(maskBool, minRegionSize);

  // 计算清理后的总面积
  let totalArea = 0;
  for (const row of cleaned) {
    for (const val of row) {
      if (val) totalArea++;
    }
  }

  if (totalArea < minArea) {
    return null;
  }

  return cleaned.map(row => row.map(val => (val ? 1 : 0)));
}

// 检查mask是否填充洞
function isMaskFillsHole(
  mergedMask: number[][],
  mask: number[][],
  ratioThresh: number = 0.9,
): boolean {
  const height = mask.length;
  const width = mask[0].length;

  const maskFg = mask.map(row => row.map(val => val === 1));
  const holeMask = computeHoleMask(mergedMask);

  // 检查是否有洞
  let hasHole = false;
  for (const row of holeMask) {
    if (row.some(val => val)) {
      hasHole = true;
      break;
    }
  }

  if (!hasHole) {
    return false;
  }

  // 标记洞区域
  const { labeled, numFeatures } = labelConnectedComponents(holeMask);

  for (let regionLabel = 1; regionLabel <= numFeatures; regionLabel++) {
    let holeArea = 0;
    let maskInHole = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (labeled[y][x] === regionLabel) {
          holeArea++;
          if (maskFg[y][x]) {
            maskInHole++;
          }
        }
      }
    }

    if (holeArea > 0) {
      const ratio = maskInHole / holeArea;
      if (ratio >= ratioThresh) {
        return true;
      }
    }
  }

  return false;
}

// 计算重叠区域在置零后落在洞中的比例
function overlapHoleRatioAfterZero(
  mergedMask: number[][],
  region: boolean[][],
): [number, number, number] {
  const height = mergedMask.length;
  const width = mergedMask[0].length;

  // 创建临时mask
  const tempMask = mergedMask.map((row, y) => row.map((val, x) => (region[y][x] ? 0 : val)));

  const holeMask = computeHoleMask(tempMask);

  let holeOverlap = 0;
  let regionArea = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (region[y][x]) {
        regionArea++;
        if (holeMask[y][x]) {
          holeOverlap++;
        }
      }
    }
  }

  const ratio = regionArea > 0 ? holeOverlap / regionArea : 0.0;
  return [ratio, holeOverlap, regionArea];
}

// TypeScript版本的fuse_masks函数
function fuseMasks(
  masks: ImageData[],
  bgMaskIdx: number,
  backgroundMask: ImageData | null,
  minArea: number,
  minRegionSize: number,
): [ImageData, number[]] {
  // 将第一个mask的ImageData转换为数组来获取尺寸
  const firstMaskArray = imageDataToArray(masks[0]);
  const height = firstMaskArray.length;
  const width = firstMaskArray[0].length;

  // 初始化合并mask
  let mergedMask: number[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(0));
  const filteredIndices: number[] = [];

  for (let idx = 0; idx < masks.length; idx++) {
    if (idx === bgMaskIdx && backgroundMask !== null) {
      continue;
    }

    let mask = imageDataToArray(masks[idx]);
    // 1. 融合前先做小区域和小连通域过滤
    const filteredMask = filterMaskByAreaAndRegion(mask, minArea, minRegionSize);
    if (filteredMask === null) {
      console.log(`Mask ${idx} skipped: too small after region filtering`);
      continue;
    }
    mask = filteredMask;

    // 2. 镂空检测
    if (isMaskFillsHole(mergedMask, mask, 0.9)) {
      console.log(`Mask ${idx} skipped: fills a hole in merged mask (>=90%)`);
      continue;
    }

    // 2.5 与已融合前景重叠比例过滤
    let aArea = 0;
    for (const row of mergedMask) {
      for (const val of row) {
        if (val === 1) aArea++;
      }
    }

    if (aArea > 0) {
      let overlapWithA = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (mergedMask[y][x] === 1 && mask[y][x] === 1) {
            overlapWithA++;
          }
        }
      }

      const ratioCoverA = overlapWithA / aArea;
      if (ratioCoverA > 0.8) {
        console.log(
          `Mask ${idx} skipped: covers ${overlapWithA}/${aArea} (${(ratioCoverA * 100).toFixed(1)}%) of current foreground`,
        );
        continue;
      }
    }

    // 3. 正常融合
    const overlapRegion: boolean[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(false));
    const nonOverlapRegion: boolean[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(false));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y][x] === 1 && mergedMask[y][x] === 1) {
          overlapRegion[y][x] = true;
        } else if (mask[y][x] === 1 && mergedMask[y][x] === 0) {
          nonOverlapRegion[y][x] = true;
        }
      }
    }

    // 检查是否有重叠区域
    let hasOverlap = false;
    for (const row of overlapRegion) {
      if (row.some(val => val)) {
        hasOverlap = true;
        break;
      }
    }

    if (hasOverlap) {
      const [ratio, holeOverlap, regionArea] = overlapHoleRatioAfterZero(mergedMask, overlapRegion);

      if (holeOverlap > 0) {
        if (ratio >= 0.9) {
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (overlapRegion[y][x]) {
                mergedMask[y][x] = 0;
              }
            }
          }
          console.log(
            `Mask ${idx}: overlap in hole, set to 0 (hole ratio ${holeOverlap}/${regionArea} = ${(ratio * 100).toFixed(1)}%)`,
          );
        } else {
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (overlapRegion[y][x]) {
                mergedMask[y][x] = 1;
              }
            }
          }
          filteredIndices.push(idx);
          console.log(
            `Mask ${idx}: overlap in hole, set to 1 (hole ratio ${holeOverlap}/${regionArea} = ${(ratio * 100).toFixed(1)}%)`,
          );
        }
      } else {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (overlapRegion[y][x]) {
              mergedMask[y][x] = 1;
            }
          }
        }
        filteredIndices.push(idx);
        console.log(`Mask ${idx}: overlap not in hole, set to 1 (overlap_area=${regionArea})`);
      }
    }

    // 设置非重叠区域为1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (nonOverlapRegion[y][x]) {
          mergedMask[y][x] = 1;
        }
      }
    }
  }

  // 将结果转换为0-255范围并转换为ImageData
  const resultMask = mergedMask.map(row => row.map(val => val * 255));
  const resultImageData = arrayToImageData(resultMask, width, height);

  return [resultImageData, filteredIndices];
}

// TypeScript版本的remove_small_regions函数
function removeSmallRegions(mergedMask: ImageData, minRegionSize: number): ImageData {
  const maskArray = imageDataToArray(mergedMask);
  const height = maskArray.length;
  const width = maskArray[0].length;

  // 转换为布尔数组
  const maskBool = maskArray.map(row => row.map(val => val > 0));

  // 清理小连通区域
  const cleanedBool = cleanByRegionSizeBool(maskBool, minRegionSize);

  // 转换回数值数组并转换为ImageData
  const cleanedArray = cleanedBool.map(row => row.map(val => (val ? 255 : 0)));
  return arrayToImageData(cleanedArray, width, height);
}

// 计算mask的边缘接触比例（分母为边缘像素总数，分子为边缘为1的像素数）
function edgeContactRatio(mask: number[][], crop: number = 20): number {
  const height = mask.length;
  const width = mask[0].length;

  // 如果图像太小，无法进行裁剪
  if (height <= 2 * crop || width <= 2 * crop) {
    return 0.0;
  }

  // 裁剪mask，去除边界部分
  const croppedMask: number[][] = [];
  for (let y = crop; y < height - crop; y++) {
    croppedMask.push(mask[y].slice(crop, width - crop));
  }

  const croppedHeight = croppedMask.length;
  const croppedWidth = croppedMask[0].length;

  if (croppedHeight <= 0 || croppedWidth <= 0) {
    return 0.0;
  }

  let edgeContact = 0;
  let edgeTotal = 0;

  // 统计边缘接触的像素数
  // 顶部边缘
  for (let x = 0; x < croppedWidth; x++) {
    if (croppedMask[0][x] === 1) {
      edgeContact++;
    }
  }

  // 底部边缘
  for (let x = 0; x < croppedWidth; x++) {
    if (croppedMask[croppedHeight - 1][x] === 1) {
      edgeContact++;
    }
  }

  // 左侧边缘
  for (let y = 0; y < croppedHeight; y++) {
    if (croppedMask[y][0] === 1) {
      edgeContact++;
    }
  }

  // 右侧边缘
  for (let y = 0; y < croppedHeight; y++) {
    if (croppedMask[y][croppedWidth - 1] === 1) {
      edgeContact++;
    }
  }

  // 计算总边缘像素数
  edgeTotal += croppedWidth * 2; // 顶部+底部
  edgeTotal += croppedHeight * 2; // 左侧+右侧
  edgeTotal -= 4; // 四个角重复计算，需要减去

  if (edgeTotal === 0) {
    return 0.0;
  }

  return edgeContact / edgeTotal;
}

// 查找背景mask
function findBackgroundMask(
  masks: ImageData[],
  crop: number = 20,
  ratioThresh: number = 0.7,
): [number, ImageData | null] {
  let maxRatio = 0;
  let bgMaskIdx = -1;

  for (let idx = 0; idx < masks.length; idx++) {
    const maskArray = imageDataToArray(masks[idx]);
    const ratio = edgeContactRatio(maskArray, crop);

    if (ratio > maxRatio) {
      maxRatio = ratio;
      bgMaskIdx = idx;
    }
  }

  if (maxRatio >= ratioThresh) {
    return [bgMaskIdx, masks[bgMaskIdx]];
  } else {
    console.log(`未找到背景mask（边缘接触比例<${ratioThresh.toFixed(2)}），将直接融合。`);
    return [-1, null];
  }
}

// 新增：清理mask中的小连通区域，返回布尔mask
function cleanMaskByRegionSize(mask: number[][], minRegionSize: number): boolean[][] {
  const height = mask.length;
  const width = mask[0].length;
  const maskBool = mask.map(row => row.map(val => val > 0));

  const { labeled, numFeatures } = labelConnectedComponents(maskBool);
  const cleaned: boolean[][] = Array(height)
    .fill(null)
    .map(() => Array(width).fill(false));

  for (let regionLabel = 1; regionLabel <= numFeatures; regionLabel++) {
    let regionSize = 0;
    const regionPixels: [number, number][] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (labeled[y][x] === regionLabel) {
          regionSize++;
          regionPixels.push([y, x]);
        }
      }
    }

    if (regionSize >= minRegionSize) {
      for (const [y, x] of regionPixels) {
        cleaned[y][x] = true;
      }
    }
  }

  return cleaned;
}

// 新增：应用背景mask到合并的mask上
function applyBackgroundMask(
  mergedMask: ImageData,
  backgroundMask: ImageData | null,
  minRegionSize: number,
): ImageData {
  if (backgroundMask === null) {
    return mergedMask;
  }

  const mergedArray = imageDataToArray(mergedMask);
  const bgArray = imageDataToArray(backgroundMask);
  const height = mergedArray.length;
  const width = mergedArray[0].length;

  // 清理背景mask中的小连通区域
  const cleanedBg = cleanMaskByRegionSize(bgArray, minRegionSize);

  // 将清理后的背景区域在合并mask中设为0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cleanedBg[y][x]) {
        mergedArray[y][x] = 0;
      }
    }
  }

  return arrayToImageData(mergedArray, width, height);
}

// 修改主处理函数
export function processSegmentationWithBackground(
  masks: ImageData[],
  minArea: number = 50,
  minRegionSize: number = 150,
  crop: number = 20,
  ratioThresh: number = 0.2,
): {
  mergedMask: ImageData;
  idxs: number[];
} {
  // 1. 查找背景mask
  const [bgMaskIdx, backgroundMask] = findBackgroundMask(masks, crop, ratioThresh);

  // 2. 融合其余mask
  const [mergedMask, filteredIndices] = fuseMasks(
    masks,
    bgMaskIdx,
    backgroundMask,
    minArea,
    minRegionSize,
  );

  // 3. 去除孤立小点
  let finalMask = removeSmallRegions(mergedMask, minRegionSize);

  // 4. 🔥 关键修复：应用背景mask（如果找到的话）
  // 注意：Python版本在某些情况下会跳过这一步，但为了保持一致性，我们保留它
  // 如果需要与Python完全一致，可以根据具体需求来决定是否启用这一步
  if (backgroundMask !== null) {
    finalMask = applyBackgroundMask(finalMask, backgroundMask, minRegionSize);
    console.log(`应用背景mask: idx=${bgMaskIdx}`);
  }

  console.log(`处理完成，使用了 ${filteredIndices} 个masks，最小区域大小: ${minRegionSize}`);

  if (backgroundMask) {
    console.log(`找到背景mask: idx=${bgMaskIdx}`);
  }

  return {
    mergedMask: finalMask,
    idxs: filteredIndices,
  };
}
