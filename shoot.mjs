// 一木六合 · 出片：用 Chrome DevTools Protocol 逐帧驱动影片模式并截图（零依赖）
// 用法: node scripts/shoot-film.mjs            → 全片
//       FRAMES=8 node scripts/shoot-film.mjs    → 试拍 8 帧
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9455);
const W = Number(process.env.W || 1080), H = Number(process.env.H || 1920);
const WIN_W = W + 130, WIN_H = H + 190;   // 窗口留出装饰边，画布本身固定 W×H
const ONLY = Number(process.env.FRAMES || 0);
const root = path.resolve(import.meta.dirname);
const OUT = path.join(root, 'film');
const PAGE = 'file:///' + path.join(root, 'film.html').replace(/\\/g, '/') + '?film=1';

fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
  `--window-size=${WIN_W},${WIN_H}`, `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + path.join(os.tmpdir(), 'mingyun-film-profile'),
  PAGE,
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes('film=1'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('CDP 未就绪（Chrome 没起来？）');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');

let ready = false;
for (let i = 0; i < 160; i++) {
  if (await evaluate('!!(window.__film && window.__film.ready)')) { ready = true; break; }
  await sleep(500);
}
if (!ready) {
  console.error('影片未就绪，页面标题：', await evaluate('document.title'));
  process.exit(2);
}
const info = await evaluate('({dur:__film.dur, fps:__film.fps, beats:__film.beats, names:__film.names})');
console.log('影片：时长', info.dur, 's @', info.fps, 'fps；节拍', (info.beats||[]).length, '个；', info.title || '');
fs.writeFileSync(path.join(OUT, 'film.json'), JSON.stringify(info, null, 2), 'utf8');

// 画布矩形（画布固定 W×H，截图按它裁切，保证出片尺寸精确）
const clip = await evaluate('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()');
console.log(`画布矩形 ${clip.width}×${clip.height}（目标 ${W}×${H}）@ (${clip.x},${clip.y})`);
if (clip.width !== W || clip.height !== H) console.warn('⚠ 画布尺寸与目标不一致，请检查 style.css 的 body.film #stage 规则');
const capture = async () => {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true, clip: { ...clip, scale: 1 } });
  return r.result?.data;
};

// 试拍指定时刻（AT=0.5,6.5,11.5 秒）→ 只出 probe_*.png，用于快速校验构图
if (process.env.AT) {
  for (const tv of process.env.AT.split(',').map(Number)) {
    await evaluate(`__film.setTime(${tv})`, true);
    const data = await capture();
    const f = path.join(OUT, `probe_${String(tv).replace('.', '_')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('试拍 t=' + tv + 's →', path.basename(f));
  }
  ws.close(); chrome.kill();
  process.exit(0);
}

const total = Math.round(info.dur * info.fps);
const n = ONLY ? Math.min(ONLY, total) : total;
const t0 = Date.now();
let skipped = 0;
for (let f = 0; f < n; f++) {
  const file = path.join(OUT, `frame_${String(f).padStart(4, '0')}.jpg`);
  if (!process.env.REDO && fs.existsSync(file)) { skipped++; continue; }   // 可续拍
  const t = f / info.fps;
  await evaluate(`__film.setTime(${t.toFixed(4)})`, true);
  const data = await capture();
  if (!data) { console.error('帧', f, '截图失败'); continue; }
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  if ((f - skipped) % 30 === 0 || f === n - 1) {
    const el = (Date.now() - t0) / 1000;
    const done = f + 1 - skipped;
    console.log(`帧 ${f + 1}/${n}（新拍 ${done}）t=${t.toFixed(2)}s 用时 ${el.toFixed(0)}s ETA ${((el / Math.max(done, 1)) * (n - f - 1)).toFixed(0)}s`);
  }
}
console.log(`✓ 本轮完成：共 ${n} 帧（本轮新拍 ${n - skipped}，跳过 ${skipped}）→`, OUT);
ws.close();
chrome.kill();
