// 宠物「日程 / 作息」（纯逻辑，可单测）。
//
// 为什么要做：桌宠一直是"同一副状态"—— 不管你是早上 8 点还是凌晨 2 点打开，
// 它都一样活泼。加了作息之后，它会跟着真实时间变：
//   清晨刚醒（有点懵）→ 白天精神（爱走动）→ 傍晚温和 → 深夜犯困（老打瞌睡）。
// 这让"它像活着"这件事从"随机"变成"有规律"，用户能感觉到时间流逝。
//
// 设计要点：
//   1) **纯函数**：给一个时间点，算出这一时段的行为倾向。可单测、可复现。
//   2) **只调权重，不改外观**：不碰用户的图片/画布/参数，只影响"它想做什么"。
//   3) 变化要**平滑**：不是 22:00 一到就突然瘫倒，而是整段时间里逐渐变化。
//   4) 用户可以关掉（有人就喜欢它一直活泼）。

/** 一天里的几个时段（用小时划分，支持小数） */
export const DAY_PARTS = [
  { id: 'dawn',    name: '清晨', from: 5,  to: 9  },
  { id: 'morning', name: '上午', from: 9,  to: 12 },
  { id: 'noon',    name: '中午', from: 12, to: 14 },
  { id: 'day',     name: '下午', from: 14, to: 18 },
  { id: 'evening', name: '傍晚', from: 18, to: 22 },
  { id: 'night',   name: '深夜', from: 22, to: 24 },
  { id: 'late',    name: '凌晨', from: 0,  to: 5  },
];

/**
 * 给一个时间（小时，0~24），返回所属时段。
 * 用**归一化的小时**（支持 0.5、23.75 这种），跨午夜也能正确处理。
 */
export function partOfDay(hour) {
  let h = Number(hour);
  if (!Number.isFinite(h)) h = 12;
  h = ((h % 24) + 24) % 24;          // 归一化到 [0,24)
  for (const p of DAY_PARTS) {
    if (p.from <= p.to) {
      if (h >= p.from && h < p.to) return p;
    } else {
      // 跨午夜（理论上用不到，但留着更稳）
      if (h >= p.from || h < p.to) return p;
    }
  }
  return DAY_PARTS.find((p) => p.id === 'day');
}

/**
 * 每个时段的行为权重**系数**（乘到基础权重上）。
 * 1 = 不变；>1 更倾向；<1 更少。
 * 只给需要变的几项，其余默认 1。
 */
export const PART_BIAS = {
  dawn:    { walk: 0.5,  hop: 0.4,  doze: 1.6, idle: 1.5 },   // 刚醒，有点懵
  morning: { walk: 1.3,  hop: 1.4,  doze: 0.3 },               // 精神最好
  noon:    { walk: 0.8,  hop: 0.7,  doze: 1.2 },               // 午后有点乏
  day:     { walk: 1.2,  hop: 1.2,  doze: 0.5 },               // 下午又活过来
  evening: { walk: 0.9,  hop: 0.8,  doze: 1.0 },               // 傍晚温和
  night:   { walk: 0.5,  hop: 0.4,  doze: 2.2, idle: 1.4 },    // 深夜犯困
  late:    { walk: 0.3,  hop: 0.2,  doze: 3.0, idle: 1.6 },    // 凌晨基本在睡
};

/**
 * 把时段系数应用到基础权重上。
 * @param base  基础权重（如 { idle, walk, lookAround, doze, hop }）
 * @param hour  时间（小时）
 * @returns 新的权重对象（不改原对象）
 */
export function applyDayPart(base, hour) {
  const src = (base && typeof base === 'object') ? base : {};
  const part = partOfDay(hour);
  const bias = PART_BIAS[part.id] || {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const n = Number(v);
    const b = Number(bias[k]);
    out[k] = Math.max(0, (Number.isFinite(n) ? n : 0) * (Number.isFinite(b) ? b : 1));
  }
  return { weights: out, part };
}

/** 给用户看的说明（设置界面里显示当前时段） */
export function partLabel(hour) {
  const p = partOfDay(hour);
  return p ? p.name : '白天';
}

/**
 * 一整天的倾向曲线（给界面画个小提示用；也可用于测试"平滑性"）。
 * @returns [{ hour, part, dozeScale, walkScale }]
 */
export function dayCurve(stepHours = 1) {
  const step = Math.max(0.25, Number(stepHours) || 1);
  const out = [];
  for (let h = 0; h < 24; h += step) {
    const { weights, part } = applyDayPart({ walk: 1, doze: 1, hop: 1, idle: 1 }, h);
    out.push({ hour: h, part: part.id, dozeScale: weights.doze, walkScale: weights.walk });
  }
  return out;
}
