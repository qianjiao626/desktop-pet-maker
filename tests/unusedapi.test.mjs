import { ok } from './_harness.mjs';
import { scanUnusedApi } from '../scripts/scan-unused-api.mjs';

// 「preload 暴露了但没人调用」意味着功能可能没接上（见 HANDOFF 第 121 条）。
// 这个测试盯住**已经接好的那几个**，防止哪天又被改回"暴露但不调用"。
{
  const r = scanUnusedApi();
  ok('能扫出 preload 的接口总数', r.total > 50, String(r.total));
  ok('返回的是数组', Array.isArray(r.unused), typeof r.unused);

  // 这几个曾经是"暴露了没接上"的真缺口，现在必须已经被调用
  for (const name of ['setPowerSave', 'savePos', 'onLaunchProgress', 'onPeers']) {
    ok('接口已接上：' + name, !r.unused.includes(name), 'unused=' + r.unused.join(','));
  }

  // 预留/无害的接口允许存在，但数量不该失控
  ok('未调用接口数量没有暴涨（<15）', r.unused.length < 15, 'n=' + r.unused.length + ' -> ' + r.unused.join(','));
}
