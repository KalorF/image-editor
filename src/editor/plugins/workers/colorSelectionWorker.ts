export interface Point {
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
    const { width, height, data, seedPoints, tolerance, circle } = msg;
    const mask = floodFillOptimized(width, height, data, seedPoints, tolerance, circle);
    const out: FloodResultMessage = {
      kind: 'flood:result',
      jobId: msg.jobId,
      task: msg.task,
      width,
      height,
      mask,
    };
    // 传输 mask 的底层 buffer，减少拷贝
    // 注意：某些环境下需要结构化克隆，遇到问题可改为不传输
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

  // 收集种子颜色
  const seedColors: number[] = []; // [r,g,b,r,g,b,...]
  for (const s of seedPoints) {
    if (s.x < 0 || s.x >= width || s.y < 0 || s.y >= height) continue;
    const idx = (s.y * width + s.x) * 4;
    seedColors.push(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
  }
  if (seedColors.length === 0) return mask;

  // 队列实现：head 指针避免 shift()
  const qx: number[] = [];
  const qy: number[] = [];

  // 初始化：标记种子并入队（不做圆形约束，保持原始洪水扩张效果）
  for (const s of seedPoints) {
    if (s.x < 0 || s.x >= width || s.y < 0 || s.y >= height) continue;
    const id = s.y * width + s.x;
    if (!visited[id]) {
      visited[id] = 1;
      mask[id] = 255;
      qx.push(s.x);
      qy.push(s.y);
    }
  }

  // const dirs = [-1, 1, -width, width]; // 使用一维索引相邻偏移需要小心换算；此处仍然用 x/y 推导
  let head = 0;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;

    // 四邻域
    // 左右
    if (x - 1 >= 0) maybeVisit(x - 1, y);
    if (x + 1 < width) maybeVisit(x + 1, y);
    // 上下
    if (y - 1 >= 0) maybeVisit(x, y - 1);
    if (y + 1 < height) maybeVisit(x, y + 1);
  }

  return mask;

  function maybeVisit(nx: number, ny: number) {
    const id = ny * width + nx;
    if (visited[id]) return;

    const pi = id * 4;
    const pr = rgba[pi];
    const pg = rgba[pi + 1];
    const pb = rgba[pi + 2];

    // 与任意一个种子颜色相似即可
    let ok = false;
    for (let i = 0; i < seedColors.length; i += 3) {
      const dr = pr - seedColors[i];
      const dg = pg - seedColors[i + 1];
      const db = pb - seedColors[i + 2];
      const distSq = dr * dr + dg * dg + db * db;
      if (distSq <= tolSq) {
        ok = true;
        break;
      }
    }
    if (!ok) return;

    visited[id] = 1;
    mask[id] = 255;
    qx.push(nx);
    qy.push(ny);
  }
}
