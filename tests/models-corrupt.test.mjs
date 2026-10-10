import { ok } from './_harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS, listModels, isInstalled, isCorrupt, modelPath, modelsDir } from '../src/main/models.js';

// ---------- 核心回归：截断的模型不能算「已安装」 ----------
// 背景（真 bug）：模型是分块下载的，断网会留下截断文件。原判断只要求 >1MB，
// 于是一个 2MB 的垃圾文件会被当成「已安装」→ InferenceSession.create 在损坏的
// protobuf 上永久挂起（实测卡死 90s+，事件循环被同步解析阻塞）。用户看到的就是
// 「点了 AI 抠图没反应」。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petmodel-'));
const id = 'silueta';
const file = modelPath(tmp, id);
const full = MODELS[id].bytes;

function writeSize(bytes) { fs.writeFileSync(file, Buffer.alloc(bytes, 0x41)); }

try {
  ok('没有文件时不算已安装', isInstalled(tmp, id) === false);

  writeSize(2 * 1024 * 1024);                       // 正是骗过旧判断的大小
  ok('2MB 截断文件不算已安装（修复核心 bug）', isInstalled(tmp, id) === false, '2MB');
  ok('2MB 截断文件被标记 corrupt', isCorrupt(tmp, id) === true);

  writeSize(full - 1);                              // 差 1 字节（下载尾部没写完）
  ok('差 1 字节仍算完整（容差内）', isInstalled(tmp, id) === true, 'size=' + (full - 1));

  writeSize(full);
  ok('完整大小算已安装', isInstalled(tmp, id) === true);
  ok('完整文件不算 corrupt', isCorrupt(tmp, id) === false);

  writeSize(full + 1024);
  ok('略大也算已安装（不同来源的同名模型）', isInstalled(tmp, id) === true);

  writeSize(1024 * 1024);                            // 恰好 1MB
  ok('1MB 边界文件不算已安装', isInstalled(tmp, id) === false);
  ok('1MB 文件不算 corrupt（太小，更像没下）', isCorrupt(tmp, id) === false, '低于 1MB 归为未下载');

  ok('未知 id 的 isInstalled 安全返回 false', isInstalled(tmp, 'nope') === false);
  ok('未知 id 的 isCorrupt 安全返回 false', isCorrupt(tmp, 'nope') === false);
  ok('modelPath 对未知 id 抛错（防路径穿越）', (() => { try { modelPath(tmp, '../../evil'); return false; } catch { return true; } })());
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// ---------- listModels 必须暴露 corrupt，界面才能提示「重新下载」 ----------
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'petmodel2-'));
  try {
    fs.writeFileSync(path.join(modelsDir(tmp2), MODELS.isnetAnime.file), Buffer.alloc(3 * 1024 * 1024, 1));
    const list = listModels(tmp2);
    ok('listModels 每项都有 corrupt 字段', list.every((m) => typeof m.corrupt === 'boolean'));
    const anime = list.find((m) => m.id === 'isnetAnime');
    ok('截断的模型 installed=false', anime.installed === false);
    ok('截断的模型 corrupt=true', anime.corrupt === true);
    const other = list.find((m) => m.id === 'silueta');
    ok('没下载的模型 corrupt=false（不误报）', other.corrupt === false && other.installed === false);
  } finally {
    try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch {}
  }
}
