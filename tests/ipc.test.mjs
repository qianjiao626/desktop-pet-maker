import fs from 'node:fs';
import path from 'node:path';
import { ok } from './_harness.mjs';

// 静态交叉校验：渲染进程/preload 用到的 IPC 通道，主进程必须都已注册
// 通道名拼错或漏注册会静默失效（按钮点了没反应），单元测试抓不到——所以在此专测

const read = (p) => fs.readFileSync(p, 'utf8');
const preload = read('src/preload/preload.cjs');
const main = read('src/main/main.js');
const maker = read('src/maker/maker.js');
const pet = read('src/pet/pet.js');

function collectChannels(src) {
  const out = new Set();
  // ipcRenderer.invoke('x') / ipcRenderer.send('x')
  for (const m of src.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)) out.add(m[1]);
  return out;
}
function collectHandlers(src) {
  const handled = new Set(), oned = new Set();
  for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) handled.add(m[1]);
  for (const m of src.matchAll(/ipcMain\.on\(\s*'([^']+)'/g)) oned.add(m[1]);
  return { handled, oned };
}
// 渲染进程通过 window.api.xxx(...) 调用的 API 名
function collectApiCalls(src) {
  const out = new Set();
  for (const m of src.matchAll(/window\.api\.(\w+)\(/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bapi\.(\w+)\(/g)) out.add(m[1]);
  return out;
}
// preload 暴露的 api 键（含箭头函数名）
function collectExposed(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s{2}(\w+):/gm)) out.add(m[1]);
  return out;
}

const { handled, oned } = collectHandlers(main);
const allRegistered = new Set([...handled, ...oned]);
const used = collectChannels(preload);

// 1. preload 用到的通道全部已注册
const missing = [...used].filter((c) => !allRegistered.has(c));
ok('preload 所用的 IPC 通道都已注册', missing.length === 0, missing.length ? '缺失: ' + missing.join(', ') : used.size + ' 个通道');

// 2. 注册的通道都用到了（防死代码）
const unused = [...allRegistered].filter((c) => !used.has(c));
ok('无未使用的 IPC 通道', unused.length === 0, unused.length ? '未用: ' + unused.join(', ') : 'ok');

// 3. invoke 的通道必须是 handle，send 的必须是 on
const invoked = new Set();
for (const m of preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) invoked.add(m[1]);
const sent = new Set();
for (const m of preload.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)) sent.add(m[1]);
const invokeNotHandled = [...invoked].filter((c) => !handled.has(c));
ok('invoke 通道均为 ipcMain.handle', invokeNotHandled.length === 0, invokeNotHandled.join(', '));
const sendNotOn = [...sent].filter((c) => !oned.has(c));
ok('send 通道均为 ipcMain.on', sendNotOn.length === 0, sendNotOn.join(', '));

// 4. 渲染进程调用的 window.api.* 都已在 preload 暴露
const exposed = collectExposed(preload);
const calledMaker = collectApiCalls(maker);
const calledPet = collectApiCalls(pet);
const notExposed = [...new Set([...calledMaker, ...calledPet])].filter((n) => !exposed.has(n));
ok('renderer 调用的 api 均已暴露', notExposed.length === 0, notExposed.join(', '));

// 5. 关键 AI 通道存在
for (const ch of ['ai:listModels', 'ai:downloadModel', 'ai:deleteModel', 'ai:segment']) {
  ok('AI 通道已注册: ' + ch, allRegistered.has(ch));
}
for (const api of ['listModels', 'downloadModel', 'deleteModel', 'segment', 'onDownloadProgress']) {
  ok('AI api 已暴露: ' + api, exposed.has(api));
}
// 6. segment 签名与 main 的参数解构一致
ok('segment 传 4 参', /segment:\s*\(modelId,\s*dataUrl,\s*threshold,\s*feather\)/.test(preload));
ok('main 解构 modelId/dataUrl/threshold/feather', /ai:segment[\s\S]{0,200}modelId,\s*dataUrl,\s*threshold,\s*feather/.test(main));