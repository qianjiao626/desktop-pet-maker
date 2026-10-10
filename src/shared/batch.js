// 批量处理：把一批图片各自变成独立的宠物包并入库。
//
// 与「多帧图片 = 一只宠物」的区别（这是本功能的核心取舍）：
//   用户从相机/素材站一次拖进来 20 张**互不相干**的立绘是很自然的动作。
//   旧行为会把它们当成同一只宠物的 20 帧 → 得到一只疯狂闪烁的怪物。
//   所以这里提供一条独立通道：**每张图 = 一只宠物**，各自抠图、各自命名、各自入库。
//
// 设计要点：
//   1. 纯逻辑（命名 / 默认包构造）放这里，可单测；磁盘与 ONNX 由 main.js 注入。
//   2. 批量最容易出现的坑是「中途失败留下一堆半成品」——所以每个包都是
//      先写临时文件、校验可读、再原子 rename 入库（沿用 pet:install 的既有做法）。
//   3. 支持取消：用户拖了 50 张发现跑太久，要能停下来，且已经完成的那些要保留。

import { normalizePack } from './petpack.js';
import { safeFileName } from './safeid.js';

/** 从文件名推一个像样的宠物名：去扩展名、去掉常见的 frame/编号噪声 */
export function petNameFromFile(fileName) {
  let s = String(fileName == null ? '' : fileName);
  s = s.replace(/^.*[\\/]/, '');                 // 去掉可能的路径
  s = s.replace(/\.[a-z0-9]{1,8}$/i, '');        // 去扩展名
  // 常见导出命名：sprite_001 / frame-12 / 角色_0003 → 去掉尾部的分隔符+序号
  s = s.replace(/[\s_-]*\d{1,6}$/, '');
  s = s.replace(/[\s_-]+$/, '');
  if (!s) s = '我的桌宠';
  return Array.from(s).slice(0, 40).join('');
}

/**
 * 为一组图片生成「批量任务」描述。
 * @param {Array<{name:string, dataUrl:string}>} images
 * @param {object} opt { nameMode?: 'file'|'prefix', prefix?: string, scale?: number }
 * @returns {Array<{index, fileName, name, dataUrl, outName}>}
 */
export function planBatch(images, opt = {}) {
  const list = Array.isArray(images) ? images : [];
  const mode = opt.nameMode === 'prefix' ? 'prefix' : 'file';
  const prefix = String(opt.prefix || '桌宠').trim() || '桌宠';
  const used = new Map();     // 处理重名：同一批里出现两个 "cat" 要能区分开
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const src = list[i] || {};
    let name = mode === 'prefix' ? (prefix + (list.length > 1 ? ' ' + (i + 1) : '')) : petNameFromFile(src.name);
    const key = name;
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n > 1) name = name + ' (' + n + ')';       // 重名不覆盖，加序号
    out.push({
      index: i,
      fileName: String(src.name || ''),
      name,
      dataUrl: src.dataUrl,
      outName: safeFileName(name, { maxLen: 60, fallback: 'pet' }) + '.petpack',
    });
  }
  return out;
}

/**
 * 构造单个宠物的默认包（批量模式下每只都用同一套外观/物理默认值，用户可事后微调）。
 * @param {object} tpl 基础模板（来自当前界面配置），但会强制单帧
 */
export function batchPackFor(name, tpl = {}, outFileName = 'pet.png') {
  const base = { ...(tpl || {}) };
  // 每只宠物都只有自己那一帧；不继承当前编辑中的帧序列
  return normalizePack({
    ...base,
    id: 'pet-' + Math.random().toString(36).slice(2, 10),
    name,
    frames: [{ file: outFileName, durationMs: 120 }],
    createdAt: new Date().toISOString(),
    canvas: base.canvas || { width: 0, height: 0 },
  });
}

/**
 * 汇总批量结果，生成给用户看的一句话总结 + 失败明细。
 * @param {Array<{ok:boolean, name?:string, error?:string, canceled?:boolean, skipped?:boolean}>} results
 */
export function summarizeBatch(results) {
  const list = Array.isArray(results) ? results : [];
  const ok = list.filter((r) => r && r.ok).length;
  const failed = list.filter((r) => r && !r.ok && !r.canceled && !r.skipped);
  const canceled = list.filter((r) => r && r.canceled).length;
  const skipped = list.filter((r) => r && r.skipped).length;
  const parts = [];
  if (ok) parts.push('成功 ' + ok + ' 只');
  if (failed.length) parts.push('失败 ' + failed.length + ' 只');
  if (skipped) parts.push('跳过 ' + skipped + ' 只');
  if (canceled) parts.push('取消 ' + canceled + ' 只');
  return {
    ok, failed: failed.length, canceled, skipped,
    total: list.length,
    text: parts.length ? parts.join('、') : '没有可处理的图片',
    failures: failed.map((f) => ({ name: f.name || '', error: f.error || '' })).slice(0, 20),
  };
}
