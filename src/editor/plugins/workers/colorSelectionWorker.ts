interface Point {
  x: number;
  y: number;
}

interface FloodMessage {
  kind: 'flood';
  jobId: number;
  task: 'preview' | 'final';
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
  seedPoints: Point[];
  tolerance: number;
  circle?: { cx: number; cy: number; r: number };
  // 新增：是否连续（默认 true 保持向后兼容）
  continuous?: boolean;
}

interface FloodResultMessage {
  kind: 'flood:result';
  jobId: number;
  task: 'preview' | 'final';
  width: number;
  height: number;
  mask: Uint8Array;
}

self.onmessage = (e: MessageEvent<FloodMessage>) => {
  const msg = e.data;
  if (!msg || msg.kind !== 'flood') return;
  try {
    const { width, height, data, seedPoints, tolerance, circle, continuous = true } = msg;

    // 根据模式选择算法
    const mask = continuous
      ? floodFillOptimized(width, height, data, seedPoints, tolerance, circle)
      : selectColorGlobal(width, height, data, seedPoints, tolerance);

    const out: FloodResultMessage = {
      kind: 'flood:result',
      jobId: msg.jobId,
      task: msg.task,
      width,
      height,
      mask,
    };
    (self as any).postMessage(out, [out.mask.buffer]);
  } catch (_err) {
    // 失败则返回空掩码，避免阻塞主线程逻辑
    const empty = new Uint8Array(msg.width * msg.height);
    const out: FloodResultMessage = {
      kind: 'flood:result',
      jobId: msg.jobId,
      task: msg.task,
      width: msg.width,
      height: msg.height,
      mask: empty,
    };
    (self as any).postMessage(out, [out.mask.buffer]);
  }
};

function floodFillOptimized(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  seedPoints: Point[],
  tolerance: number,
  _circle?: { cx: number; cy: number; r: number },
): Uint8Array {
  const total = width * height;
  const mask = new Uint8Array(total);
  const visited = new Uint8Array(total);

  // 预计算容差平方，避免 sqrt
  const tolSq = tolerance * tolerance;

  // 收集并去重种子颜色（包括 alpha 通道）
  const seedColorsSet = new Set<string>();
  const seedColorIndices: number[] = []; // 记录种子点索引

  for (const s of seedPoints) {
    if (s.x < 0 || s.x >= width || s.y < 0 || s.y >= height) continue;
    const idx = (s.y * width + s.x) * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];

    const key = `${r},${g},${b},${a}`;

    if (!seedColorsSet.has(key)) {
      seedColorsSet.add(key);
      seedColorIndices.push(idx);
    }
  }

  if (seedColorIndices.length === 0) return mask;

  // 提取种子颜色到独立数组以优化访问（包括 alpha）
  const seedR: number[] = [];
  const seedG: number[] = [];
  const seedB: number[] = [];
  const seedA: number[] = []; // alpha 通道

  for (const idx of seedColorIndices) {
    seedR.push(rgba[idx]);
    seedG.push(rgba[idx + 1]);
    seedB.push(rgba[idx + 2]);
    seedA.push(rgba[idx + 3]);
  }

  const seedCount = seedR.length;

  // 优化：使用单一队列存储坐标（交替存储 x,y）
  // 比两个独立数组更好的缓存局部性
  const queue: number[] = [];
  let head = 0;

  // 初始化：标记种子并入队
  for (const s of seedPoints) {
    if (s.x < 0 || s.x >= width || s.y < 0 || s.y >= height) continue;

    const id = s.y * width + s.x;
    if (!visited[id]) {
      visited[id] = 1;
      mask[id] = 255;
      queue.push(s.x, s.y);
    }
  }

  // 预计算常用值
  const maxX = width - 1;
  const maxY = height - 1;

  // BFS 主循环
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];

    // 四邻域展开（减少函数调用）
    // 左
    if (x > 0) {
      const nx = x - 1;
      const id = y * width + nx;
      if (!visited[id] && checkColor(id)) {
        visited[id] = 1;
        mask[id] = 255;
        queue.push(nx, y);
      }
    }

    // 右
    if (x < maxX) {
      const nx = x + 1;
      const id = y * width + nx;
      if (!visited[id] && checkColor(id)) {
        visited[id] = 1;
        mask[id] = 255;
        queue.push(nx, y);
      }
    }

    // 上
    if (y > 0) {
      const ny = y - 1;
      const id = ny * width + x;
      if (!visited[id] && checkColor(id)) {
        visited[id] = 1;
        mask[id] = 255;
        queue.push(x, ny);
      }
    }

    // 下
    if (y < maxY) {
      const ny = y + 1;
      const id = ny * width + x;
      if (!visited[id] && checkColor(id)) {
        visited[id] = 1;
        mask[id] = 255;
        queue.push(x, ny);
      }
    }
  }

  return mask;

  // 内联颜色检查函数（包含 alpha 检查）
  function checkColor(id: number): boolean {
    const pi = id * 4;
    const pr = rgba[pi];
    const pg = rgba[pi + 1];
    const pb = rgba[pi + 2];
    const pa = rgba[pi + 3]; // 读取 alpha 通道

    // 优化：单种子颜色快速路径
    if (seedCount === 1) {
      const dr = pr - seedR[0];
      const dg = pg - seedG[0];
      const db = pb - seedB[0];
      const da = pa - seedA[0]; // alpha 差值
      const distSq = dr * dr + dg * dg + db * db;
      const alphaDistSq = da * da;
      // 综合考虑 RGB 和 Alpha 的距离，alpha 权重较低
      return distSq + alphaDistSq * 0.1 <= tolSq;
    }

    // 多种子颜色：与任意一个相似即可
    for (let i = 0; i < seedCount; i++) {
      const dr = pr - seedR[i];
      const dg = pg - seedG[i];
      const db = pb - seedB[i];
      const da = pa - seedA[i]; // alpha 差值
      const distSq = dr * dr + dg * dg + db * db;
      const alphaDistSq = da * da;
      // 综合考虑 RGB 和 Alpha 的距离，alpha 权重较低
      if (distSq + alphaDistSq * 0.1 <= tolSq) {
        return true;
      }
    }
    return false;
  }
}

/**
 * 不连续颜色选择：遍历全图，选择所有与种子点颜色相似的像素
 * 性能优化：
 * 1. 种子颜色去重
 * 2. 单种子颜色快速路径
 * 3. 循环展开减少判断
 * 4. 同时考虑 alpha 通道相似度
 */
function selectColorGlobal(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  seedPoints: Point[],
  tolerance: number,
): Uint8Array {
  const total = width * height;
  const mask = new Uint8Array(total);

  // 预计算容差平方
  const tolSq = tolerance * tolerance;

  // 收集并去重种子颜色（包括 alpha）
  const seedColorsSet = new Set<string>();
  for (const s of seedPoints) {
    if (s.x < 0 || s.x >= width || s.y < 0 || s.y >= height) continue;
    const idx = (s.y * width + s.x) * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];
    // 使用字符串键去重（包括 alpha）
    seedColorsSet.add(`${r},${g},${b},${a}`);
  }

  if (seedColorsSet.size === 0) return mask;

  // 转为数组便于遍历（包括 alpha）
  const seedColors: number[] = [];
  for (const colorStr of seedColorsSet) {
    const [r, g, b, a] = colorStr.split(',').map(Number);
    seedColors.push(r, g, b, a);
  }

  const seedCount = seedColors.length / 4; // 现在每个种子颜色有 4 个值

  // 优化：单种子颜色快速路径（最常见情况）
  if (seedCount === 1) {
    const sr = seedColors[0];
    const sg = seedColors[1];
    const sb = seedColors[2];
    const sa = seedColors[3]; // 种子 alpha

    // 直接遍历，无内层循环
    for (let i = 0; i < total; i++) {
      const pi = i * 4;
      const pa = rgba[pi + 3];

      const pr = rgba[pi];
      const pg = rgba[pi + 1];
      const pb = rgba[pi + 2];

      const dr = pr - sr;
      const dg = pg - sg;
      const db = pb - sb;
      const da = pa - sa; // alpha 差值
      const distSq = dr * dr + dg * dg + db * db;
      const alphaDistSq = da * da;

      // 综合考虑 RGB 和 Alpha 的距离，alpha 权重较低
      if (distSq + alphaDistSq * 0.1 <= tolSq) {
        mask[i] = 255;
      }
    }
    return mask;
  }

  // 多种子颜色路径
  // 提前提取所有种子颜色到局部变量，减少数组访问
  const seedR: number[] = [];
  const seedG: number[] = [];
  const seedB: number[] = [];
  const seedA: number[] = []; // alpha 通道

  for (let i = 0; i < seedColors.length; i += 4) {
    seedR.push(seedColors[i]);
    seedG.push(seedColors[i + 1]);
    seedB.push(seedColors[i + 2]);
    seedA.push(seedColors[i + 3]);
  }

  // 遍历全图
  for (let i = 0; i < total; i++) {
    const pi = i * 4;
    const pa = rgba[pi + 3];

    const pr = rgba[pi];
    const pg = rgba[pi + 1];
    const pb = rgba[pi + 2];

    // 与任意种子颜色匹配即可
    for (let j = 0; j < seedCount; j++) {
      const dr = pr - seedR[j];
      const dg = pg - seedG[j];
      const db = pb - seedB[j];
      const da = pa - seedA[j]; // alpha 差值
      const distSq = dr * dr + dg * dg + db * db;
      const alphaDistSq = da * da;

      // 综合考虑 RGB 和 Alpha 的距离，alpha 权重较低
      if (distSq + alphaDistSq * 0.1 <= tolSq) {
        mask[i] = 255;
        break; // 提前退出内层循环
      }
    }
  }

  return mask;
}
