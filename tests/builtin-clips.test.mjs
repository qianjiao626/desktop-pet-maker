import { ok } from './_harness.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { zipRead } from '../src/shared/zip.js';
import { normalizePack } from '../src/shared/petpack.js';

// ★ 守护：内置宠物必须**每只都带多段动作**。
//
// 背景（用户报的真实问题）：内置宠物此前**每只只有一段循环** ——
// 用户第一次打开看到的是"永远重复同一个动作"。而我们早就做了
// "多段动作随机切换"的能力，却没让自家宠物用上（开箱体验的缺口）。
{
  const dir = 'examples';
  const files = readdirSync(dir).filter((f) => /\.petpack$/i.test(f));
  ok('内置宠物数量 >= 30', files.length >= 30, String(files.length));

  const noClips = [];
  const brokenRefs = [];
  const sizeMismatch = [];
  for (const f of files) {
    const entries = zipRead(readFileSync(dir + '/' + f));
    const mani = JSON.parse(entries.find((e) => e.name === 'pet.json').data.toString('utf8'));
    const pack = normalizePack(mani);
    const names = new Set(entries.map((e) => e.name));
    if (!pack.clips.length) { noClips.push(f); continue; }
    // 片段帧文件必须真的在包里（否则运行时加载失败、整段被丢）
    for (const c of pack.clips) {
      for (const fr of c.frames) if (!names.has(fr.file)) brokenRefs.push(f + ':' + fr.file);
    }
    // ★ 片段与主帧必须**同尺寸** —— 否则切片段时宠物会突然缩放、窗口跟着跳
    //   （v0.9.47 修过这个真缺陷，这里锁住内置宠物也别踩）
    const mainBuf = entries.find((e) => e.name === pack.frames[0].file).data;
    const clipBuf = entries.find((e) => e.name === pack.clips[0].frames[0].file).data;
    // 用 PNG 头里的宽高（IHDR: 16..24 字节）
    const dim = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    const m = dim(mainBuf), c2 = dim(clipBuf);
    if (m.w !== c2.w || m.h !== c2.h) sizeMismatch.push(`${f} 主帧 ${m.w}x${m.h} vs 片段 ${c2.w}x${c2.h}`);
  }

  ok('每只内置宠物都带动作片段（不再是"永远重复一段"）',
    noClips.length === 0, noClips.slice(0, 6).join(', '));
  ok('所有片段帧文件都在包内（不是悬空引用）',
    brokenRefs.length === 0, brokenRefs.slice(0, 6).join(', '));
  ok('片段画布尺寸与主帧一致（切动作不会突然缩放）',
    sizeMismatch.length === 0, sizeMismatch.slice(0, 4).join(' | '));
}

// ---------- 片段本身要"能用"：名字可读、权重为正、时长合理 ----------
{
  const f = readdirSync('examples').filter((x) => /\.petpack$/i.test(x))[0];
  const entries = zipRead(readFileSync('examples/' + f));
  const pack = normalizePack(JSON.parse(entries.find((e) => e.name === 'pet.json').data.toString('utf8')));
  ok('片段有可读的名字（不是一串 id）',
    pack.clips.every((c) => c.name && !/^clip_/.test(c.name)), JSON.stringify(pack.clips.map((c) => c.name)));
  ok('片段权重都是正数', pack.clips.every((c) => c.weight > 0), JSON.stringify(pack.clips.map((c) => c.weight)));
  ok('每段至少 2 帧（1 帧不叫动作）',
    pack.clips.every((c) => c.frames.length >= 2), JSON.stringify(pack.clips.map((c) => c.frames.length)));
  ok('帧时长合理（16ms ~ 5s）',
    pack.clips.every((c) => c.frames.every((fr) => fr.durationMs >= 16 && fr.durationMs <= 5000)), 'ok');
}

// ---------- 生成脚本必须都接上了动作片段（防止以后重新生成时又丢） ----------
{
  const scripts = readdirSync('scripts').filter((x) => /^make-.*\.mjs$/.test(x) && x !== 'make-icon.mjs');
  ok('找到生成脚本', scripts.length >= 6, String(scripts.length));
  const missing = [];
  for (const s of scripts) {
    const src = readFileSync('scripts/' + s, 'utf8');
    // make-cute-pets 依赖外部素材目录、且那三只已由 add-clips-to-pack 处理
    if (s === 'make-cute-pets.mjs') continue;
    if (!/buildActionClips|add-clips-to-pack/.test(src)) missing.push(s);
  }
  ok('生成脚本都接上了动作片段（重新生成不会丢）', missing.length === 0, missing.join(', '));
}
