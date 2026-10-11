// 《河床》· 地貌演化（标准模型）：D8 汇流累积 + 河流功率下切 + 恒定抬升 → 树枝状河网
import fs from 'node:fs';
const N = 340, M = 191, T = 520, U = 0.0009, K = 0.0016;
const H = new Float32Array(N * M), A = new Float32Array(N * M);
let s0 = 7; const R = () => { s0 = (s0 * 1103515245 + 12345) & 0x7fffffff; return s0 / 0x7fffffff; };
// 初始地形：东向基准坡降 + 极小随机扰动（扰动决定河道长在哪）
for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) H[y * N + x] = 1.25 * (1 - x / N) + (R() - 0.5) * 0.006;
const idx = new Int32Array(N * M), order = new Int32Array(N * M), nbr = new Int32Array(N * M);
for (let i = 0; i < N * M; i++) idx[i] = i;
const DIAG = Math.SQRT1_2;
function step() {
  for (let i = 0; i < N * M; i++) H[i] += U;                       // 抬升
  for (let x = 0; x < N; x++) H[(M - 1) * N + x] = 0;              // 南边界为基准面（出水口）
  // D8 最陡下降
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x, hi = H[i]; let bj = -1, bs = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const j = (y + dy) * N + (x + dx), dd = Math.hypot(dx, dy);
      const s = (hi - H[j]) / dd;
      if (s > bs) { bs = s; bj = j; }
    }
    nbr[i] = bj;
  }
  // 汇流累积：按高度从高到低，把本格流量交给下游
  order.set(idx); const arr = Array.from(order);
  arr.sort((a, b) => H[b] - H[a]);
  order.set(arr);
  A.fill(1);
  for (let k = 0; k < N * M; k++) { const i = order[k], j = nbr[i]; if (j >= 0) A[j] += A[i]; }
  // 河流功率下切：dh = K · A^0.5 · S
  for (let y = 1; y < M - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x, j = nbr[i];
    if (j < 0) continue;
    const dd = (Math.abs((j % N) - x) + Math.abs(((j - j % N) / N) - y)) > 1 ? DIAG : 1;
    const S = Math.max(0, (H[i] - H[j]) / dd);
    const dh = Math.min(0.02, K * Math.sqrt(A[i]) * S);
    H[i] -= dh;
  }
}
for (let t = 0; t < T; t++) { step(); if (t % 130 === 0 || t === T - 1) {
  let mx = -9, mn = 9, ch = 0;
  for (let i = 0; i < N * M; i++) { if (H[i] > mx) mx = H[i]; if (H[i] < mn) mn = H[i]; if (A[i] > 600) ch++; }
  console.log(`迭代 ${t}：极差 ${(mx - mn).toFixed(3)}；大流量河道格 ${ch}（${(ch / (N * M) * 100).toFixed(1)}%）`);
} }
// 着色输出（坡度光照 + 河道偏蓝）
const pad = (N * 3) % 4 ? 4 - (N * 3) % 4 : 0, size = 54 + (N * 3 + pad) * M, b = Buffer.alloc(size);
b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
b.writeInt32LE(N, 18); b.writeInt32LE(M, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x;
  const gx = (H[i + 1] || H[i]) - (H[i - 1] || H[i]), gy = (H[i + N] || H[i]) - (H[i - N] || H[i]);
  const wet = Math.min(1, Math.max(0, (Math.log10(A[i]) - 1.6) / 1.9));
  const v = Math.max(0.08, Math.min(1, 0.62 + (-gx - gy) * 12));
  const o = 54 + (M - 1 - y) * (N * 3 + pad) + x * 3;
  b[o] = Math.round(255 * (v * 0.80 - wet * 0.30));       // B
  b[o + 1] = Math.round(255 * (v * 0.86 - wet * 0.16));   // G
  b[o + 2] = Math.round(255 * (v * 0.92));                // R
}
fs.writeFileSync('film16/river.bmp', b);
console.log('已输出 film16/river.bmp');
