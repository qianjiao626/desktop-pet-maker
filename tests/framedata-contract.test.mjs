import fs from 'node:fs';
import { ok } from './_harness.mjs';

// 静态守护：帧数据必须是「真 ImageData」而不是长得像的普通对象。
//
// 背景（真实回归，2026-10-13 踩到）：autoCutIfNeeded 曾经返回
//   { current: { width, height, data }, __autoCut: true }
// 这是个**普通对象**，下游 unifyToCanvas / imageDataToDataURL 会直接
// 把它交给 ctx.putImageData()，于是抛：
//   "parameter 1 is not of type 'ImageData'"
// 表现为：单帧替换整条链路静默失败，状态栏只有一句笼统的失败原因。
//
// 这个 bug 潜伏很久没被发现，是因为旧 floodCut 的羽化让"几乎没扣掉东西"
// 兜底经常命中、直接返回原帧（真 ImageData）；一旦自动抠图真的生效就炸。
// 所以这里用**静态扫描**锁住契约，而不是只依赖某个 e2e 恰好走到这条路。

const maker = fs.readFileSync('src/maker/maker.js', 'utf8');

{
  // 全文件扫描"用裸对象冒充 ImageData 当帧数据"。
  //
  // ★ 有两种写法，必须区分开（第一版一刀切，把安全的那种也误报了）：
  //   ① 危险：**直接作为帧数据交给下游 putImageData** —— autoCutIfNeeded 就是这种，
  //      它的返回值会被 unifyToCanvas / imageDataToDataURL 直接 putImageData。
  //   ② 安全：先放进 state.frames，随后立刻经 rebuildAll() -> processFrame()
  //      规整成真 ImageData —— 角色工坊的 qcompose 路径是这种，它有 original:null
  //      且紧随其后调用 rebuildAll()，所以中间态不会漏到 canvas 上。
  //
  //   判据：出现裸对象 current 时，同一函数体内必须能看到 rebuildAll/processFrame/
  //   toImageData 这类"规整动作"；否则视为危险。
  const code = maker
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 剥掉块注释：说明文字本身就长得像坏代码
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // 剥掉行注释（避开 http://）
  const bare = /current:\s*\{\s*width\s*:[^}]*data\s*:/g;
  const dangerous = [];
  let m;
  while ((m = bare.exec(code))) {
    // 取该处往前 1200 字符（够覆盖所在函数体）判断有没有规整动作
    const around = code.slice(Math.max(0, m.index - 1200), m.index + 400);
    const normalized = /rebuildAll\(\)|processFrame\(|toImageData\(/.test(around);
    if (!normalized) {
      const line = code.slice(0, m.index).split('\n').length;
      dangerous.push('第 ' + line + ' 行附近的裸对象 current 没有紧跟规整动作');
    }
  }
  ok('裸对象帧数据都有规整动作兜底（不会直接进 canvas）', dangerous.length === 0, dangerous.join(' | '));
}

{
  // autoCutIfNeeded 的返回值必须经过 toImageData 包装
  const m = /function autoCutIfNeeded[\s\S]*?\n\}/.exec(maker);
  ok('找得到 autoCutIfNeeded', !!m);
  if (m) {
    const body = m[0];
    ok('autoCutIfNeeded 返回的帧经过 toImageData 包装',
      /__autoCut:\s*true[\s\S]*?toImageData\(|toImageData\([^)]*\)[\s\S]*?__autoCut/.test(body),
      body.slice(-260));
  }
}

{
  // ★ 真正要拦的反模式：把**帧对象的字段**（.current / .original）直接交给 putImageData。
  //   帧对象上的 .current 按设计就是 ImageData；一旦某处把它塞成普通对象
  //   （就是上面那个回归），这里会立刻报出来。
  //   注意不要写成"变量名白名单"式的粗扫描 —— 那样会误报合法的
  //   `const src = new ImageData(...); putImageData(src, 0, 0)`。
  const bad = [];
  maker.split('\n').forEach((ln, i) => {
    const m = /\.putImageData\(\s*([\w$.\[\]]+)\s*,/.exec(ln);
    if (!m) return;
    const v = m[1];
    // 直接传帧字段 = 反模式（帧字段应先用 toImageData/new ImageData 规整）
    if (/\.(current|original)\s*$/.test(v)) bad.push((i + 1) + ': ' + ln.trim());
  });
  ok('没有把帧对象的 .current/.original 直接交给 putImageData', bad.length === 0, bad.join(' | '));
}
