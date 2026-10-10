import { ok } from './_harness.mjs';
import { assessCut, cutAdvice, floodCut } from '../src/shared/imageops.js';

const W = 200, H = 200;
function mk(f) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const c = f(x, y);
    d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=c[3];
  }
  return d;
}
const R = (x, y) => Math.hypot(x - W/2, y - H/2);
const clean = mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : [0,0,0,0]);
const noCut = mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : [255,255,255,255]);
const empty  = mk(() => [0,0,0,0]);
const halo   = mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : (R(x,y) < 62 ? [225,222,215,255] : [0,0,0,0]));
const badHalo= mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : (R(x,y) < 72 ? [235,232,226,255] : [0,0,0,0]));

// ---------- 四种基本判定 ----------
ok('干净抠图 -> ok', assessCut(clean, W, H).verdict === 'ok', JSON.stringify(assessCut(clean,W,H)));
ok('背景没扣 -> no-cut', assessCut(noCut, W, H).verdict === 'no-cut', JSON.stringify(assessCut(noCut,W,H)));
ok('主体被扣没 -> empty', assessCut(empty, W, H).verdict === 'empty');
ok('全透明 empty 标志为 true', assessCut(empty, W, H).empty === true);
ok('干净图 empty 为 false', assessCut(clean, W, H).empty === false);

// ---------- 关键：正常羽化抠图不能被误报（这是实现里踩过的坑）----------
{
  const img = mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : [255,255,255,255]);
  for (const feather of [0, 7, 14]) {
    const out = floodCut(img, W, H, { tol: 38, feather });
    const a = assessCut(out.data, out.width, out.height);
    ok(`正常抠图（feather=${feather}）判定为 ok（不误报）`, a.verdict === 'ok', `verdict=${a.verdict} halo=${a.halo}`);
  }
}
{
  const bg = (x,y) => [240-Math.round(x/W*30), 242-Math.round(y/H*30), 248-Math.round(y/H*20), 255];
  const img = mk((x,y) => R(x,y) < 55 ? [255,140,60,255] : bg(x,y));
  const out = floodCut(img, W, H, { tol: 38, feather: 14 });
  const a = assessCut(out.data, out.width, out.height);
  ok('渐变背景正常抠图判定为 ok（不误报）', a.verdict === 'ok', `verdict=${a.verdict} halo=${a.halo}`);
}

// ---------- 真实残留必须被检出（否则功能等于没做）----------
ok('轻微光晕残留 -> halo', assessCut(halo, W, H).verdict === 'halo', JSON.stringify(assessCut(halo,W,H)));
ok('明显光晕残留 -> halo', assessCut(badHalo, W, H).verdict === 'halo', JSON.stringify(assessCut(badHalo,W,H)));
ok('残留越重 halo 值越大', assessCut(badHalo,W,H).halo > assessCut(halo,W,H).halo,
  `${assessCut(badHalo,W,H).halo} > ${assessCut(halo,W,H).halo}`);

// ---------- 抠图强度不足（背景大片残留）也应被提示 ----------
{
  const bg = (x,y) => [240-Math.round(x/W*30), 242-Math.round(y/H*30), 248-Math.round(y/H*20), 255];
  const img = mk((x,y) => R(x,y) < 40 ? [255,140,60,255] : bg(x,y));
  const weak = floodCut(img, W, H, { tol: 1, feather: 0 });   // 容差太小 -> 基本没扣掉
  const a = assessCut(weak.data, weak.width, weak.height);
  ok('容差过小导致没扣干净 -> 给出提示（halo 或 no-cut）', a.verdict === 'halo' || a.verdict === 'no-cut', a.verdict);
}

// ---------- cutAdvice 文案可操作性 ----------
ok('ok -> 正面文案', cutAdvice({ verdict: 'ok' }).level === 'ok');
ok('no-cut -> 提示调大', cutAdvice({ verdict: 'no-cut' }).text.includes('调大'));
ok('halo -> 提示调大', cutAdvice({ verdict: 'halo' }).text.includes('调大'));
ok('empty -> 提示调小', cutAdvice({ verdict: 'empty' }).text.includes('调小'));
ok('unknown -> 不显示任何文案', cutAdvice({ verdict: 'unknown' }).text === '');
ok('null -> 安全', cutAdvice(null).text === '');

// ---------- 容错 ----------
ok('无数据安全', assessCut(null, 10, 10).verdict === 'unknown');
ok('尺寸为 0 安全', assessCut(new Uint8ClampedArray(16), 0, 0).verdict === 'unknown');
ok('coverage 在 0..1 之间', (() => { const a = assessCut(clean,W,H); return a.coverage >= 0 && a.coverage <= 1; })());
ok('halo 非负', assessCut(badHalo,W,H).halo >= 0);
