import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '.');
const info = JSON.parse(fs.readFileSync(path.join(root, 'film', 'film.json'), 'utf8'));
const SR = 48000, dur = (info.dur || 210) + 1, N = Math.ceil(SR * dur);
const L = new Float32Array(N), R = new Float32Array(N);
const R32 = (() => { let s = 7; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
const add = (sn, buf, pan = 0.5, gain = 1) => { const i0 = Math.round(sn); const gl = Math.cos(pan * Math.PI / 2) * gain, gr = Math.sin(pan * Math.PI / 2) * gain;
  for (let i = 0; i < buf.length; i++) { const k = i0 + i; if (k < 0 || k >= N) continue; L[k] += buf[i] * gl; R[k] += buf[i] * gr; } };
const burst = (len, tau, freq, hp) => { const b = new Float32Array(Math.ceil(SR * len));
  for (let i = 0; i < b.length; i++) { const t = i / SR, env = Math.exp(-t / tau);
    b[i] = (R32() * 2 - 1) * env * 0.45 + Math.sin(2 * Math.PI * freq * t) * env * 0.4; } return b; };
// 低频底噪：两段缓慢呼吸的正弦 + 低通噪声
for (let i = 0; i < N; i++) { const t = i / SR;
  const lfo = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.055 * t);
  L[i] += (Math.sin(2 * Math.PI * 46 * t) * 0.020 + Math.sin(2 * Math.PI * 92.5 * t) * 0.010) * lfo;
  R[i] += (Math.sin(2 * Math.PI * 46.3 * t) * 0.020 + Math.sin(2 * Math.PI * 92.9 * t) * 0.010) * lfo;
  const nz = (R32() * 2 - 1) * 0.004; L[i] += nz; R[i] += nz; }
for (const b of (info.beats || [])) {
  const pan = 0.35 + 0.3 * R32(), sn = b.t * SR;
  if (b.k === 'tick') add(sn, burst(0.05, 0.006, 2400, 1), pan, 0.5);
  else if (b.k === 'type') add(sn, burst(0.08, 0.02, 900, 1), pan, 0.35);
  else if (b.k === 'whoosh') { const buf = new Float32Array(Math.ceil(SR * 0.9));
    for (let i = 0; i < buf.length; i++) { const t = i / SR, env = Math.sin(Math.PI * t / 0.9), f = 90 + t * 320;
      buf[i] = ((R32() * 2 - 1) * 0.5) * env * 0.5 + Math.sin(2 * Math.PI * f * t) * env * 0.25; }
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.9; add(sn, buf, pan, 0.5); }
  else if (b.k === 'rise') { const buf = new Float32Array(Math.ceil(SR * 1.6));
    for (let i = 0; i < buf.length; i++) { const t = i / SR, env = Math.pow(t / 1.6, 1.6), f = 120 * Math.pow(3.2, t);
      buf[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.25) * env * 0.35; }
    add(sn, buf, pan, 0.6); }
  else if (b.k === 'gong') { const len = Math.ceil(SR * 4), buf = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / SR, env = Math.exp(-t * 1.25) * Math.min(1, t * 30);
      buf[i] = (Math.sin(2 * Math.PI * 92 * t) * 0.4 + Math.sin(2 * Math.PI * 138 * t) * 0.24 + Math.sin(2 * Math.PI * 207 * t) * 0.14 + (R32() * 2 - 1) * 0.02) * env * 0.26; }
    add(sn, buf, 0.5, 1); } }
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const gain = peak > 0 ? Math.min(0.9 / peak, 6) : 1, fi = Math.ceil(SR * 0.08), fo = Math.ceil(SR * 0.5);
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { const w = Math.min(1, i / fi) * Math.min(1, (N - 1 - i) / fo) * gain;
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * w * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * w * 32767))), i * 4 + 2); }
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28);
h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(root, 'film', 'audio.wav'), Buffer.concat([h, pcm]));
console.log(`✓ 音轨 film/audio.wav（${dur.toFixed(1)}s，${(info.beats || []).length} 个节拍）`);
