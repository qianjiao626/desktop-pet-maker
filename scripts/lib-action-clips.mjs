// 给内置宠物生成「多段动作」的共用工具。
//
// 背景：内置 22 只宠物此前**每只只有一段循环** —— 用户第一次打开看到的是
// "永远重复同一个动作"，而我们已经做了"多段动作随机切换"的能力，
// 却没让自家宠物用上（开箱体验的缺口）。
//
// 设计：各生成脚本的绘制函数签名不同（drawPet / drawCat / drawMonster / drawShape …），
// 所以这里不碰绘制，只负责把"同一组动作参数"展开成 pack.clips 结构。
// 每个脚本按自己的绘制函数把动作参数画成帧，交给这里组装。
//
// 为什么片段必须和主帧**同尺寸**：运行时切换片段会按新尺寸重算布局 + setSize，
// 尺寸不一致时宠物会突然缩放、窗口跟着跳（v0.9.47 修过这个真缺陷）。

/**
 * 三套"动作"参数（同一只宠物用不同的动作参数画一遍，就得到一段动作）。
 * 各脚本的绘制函数都支持这些通用开关（squash/bob/arm/tail/blink）；
 * 不支持的字段会被忽略，不会报错。
 */
export const ACTIONS = [
  {
    id: 'idle', name: '发呆', weight: 1,
    frames: [
      { o: {}, dur: 220 },
      { o: { squash: 1.03, bob: -2 }, dur: 220 },
      { o: { squash: 1.02, bob: -1 }, dur: 220 },
      { o: { squash: 1.04, bob: -3, blink: true }, dur: 300 },
    ],
  },
  {
    id: 'wave', name: '摆手', weight: 1,
    frames: [
      { o: { arm: 0.8 }, dur: 150 },
      { o: { arm: 0.2, bob: -2 }, dur: 150 },
      { o: { arm: -0.2, bob: -1 }, dur: 150 },
      { o: { arm: 0.6, bob: -3 }, dur: 150 },
    ],
  },
  {
    id: 'hop', name: '蹦跳', weight: 1,
    frames: [
      { o: { squash: 0.92, bob: 4 }, dur: 110 },     // 蹲
      { o: { squash: 1.08, bob: -8 }, dur: 130 },    // 起跳
      { o: { squash: 1.02, bob: -3 }, dur: 110 },    // 落下
      { o: { squash: 1.05, bob: -5, tail: 0.4 }, dur: 130 },
    ],
  },
];

/**
 * 把动作列表组装成 pack.clips + 额外的帧文件。
 *
 * @param actions  动作列表（默认 ACTIONS）
 * @param draw     绘制回调：draw(o) -> RGBA 像素（与主帧同尺寸）
 * @param encode   编码回调：(px) -> Buffer（PNG）
 * @param opt      { size, prefix } size 必须与主帧一致
 * @returns { clips, files }
 *   clips: 可直接塞进 normalizePack 的 clips（frames 里是文件名）
 *   files: 需要一起写进 zip 的帧文件
 */
export function buildActionClips(actions, draw, encode, opt = {}) {
  const list = Array.isArray(actions) && actions.length ? actions : ACTIONS;
  const prefix = String(opt.prefix || 'clip');
  const clips = [];
  const files = [];
  for (const a of list) {
    const cframes = [];
    for (let i = 0; i < a.frames.length; i++) {
      const f = a.frames[i];
      const name = prefix + '_' + a.id + '_' + String(i).padStart(3, '0') + '.png';
      files.push({ name, data: encode(draw(f.o)) });
      cframes.push({ file: name, durationMs: f.dur });
    }
    clips.push({
      id: prefix + '_' + a.id,
      name: a.name,
      weight: Number(a.weight) > 0 ? Number(a.weight) : 1,
      frames: cframes,
    });
  }
  return { clips, files };
}
