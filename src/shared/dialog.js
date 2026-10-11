// 宠物「对话脑」：本地规则 + 模板，不依赖任何 LLM / 网络 / API Key。
//
// 为什么不做云端 LLM：
//   - 桌宠是**常驻**的东西，用户戳一下就要立刻回应，网络往返 + 排队会显得迟钝；
//   - 要用户自带 Key、按 token 花钱，和这个工具「零依赖、上传即用」的定位冲突；
//   - 桌宠的对话场景其实很窄（被戳、被摸、被拎、无聊、睡醒、抓到虫子…），
//     用「事件 x 性格 x 随机变体」的组合模板就能覆盖得相当自然。
//
// 设计要点：
//   1) 纯函数：给同样的 (事件, 性格, 随机源) 必须给同样的输出 —— 可单测、可复现。
//   2) 变体要足够多：一句话反复出现会立刻"假"。每个事件至少 4 条变体。
//   3) 性格只改**口吻**，不改事件本身 —— 和 templates.js 的定位一致。
//   4) 支持**自定义台词优先**：用户在气泡面板写的台词永远先用（那是他的意愿）。
//   5) 冷却：同一个事件短时间内不重复说同一句（避免"戳三下说三遍一样的话"）。

/** 对话事件：桌宠运行时真实会发生的那些 */
export const EVENTS = [
  'pat',        // 被摸头
  'poke',       // 被点一下
  'grab',       // 被拎起来
  'drop',       // 被放下
  'idle',       // 长时间没人理
  'wake',       // 睡醒
  'sleepy',     // 困了
  'bug',        // 抓到虫子
  'walk',       // 开始乱走
  'pet',        // 刚上桌
];

/** 性格口吻（与 templates.js 的 5 个性格对应，外加 default） */
// 这里的名字必须与 templates.js 的模板 id 一致（贪睡是 sleepy，不是 lazy）。
// 曾一边写 lazy 一边写 sleepy，结果贪睡性格静默掉回默认口吻。
export const TONES = ['default', 'lively', 'gentle', 'sleepy', 'clingy', 'quiet'];

/**
 * 台词库：tone -> event -> [变体]
 * 找不到就回落到 default，再找不到就回落到 '*'（任意事件通用）。
 */
const LINES = {
  default: {
    '*': ['嗯？', '我在呢～', '怎么啦？'],
    pat: ['嘿嘿～', '再摸一下嘛', '这里最舒服了', '唔…好舒服'],
    poke: ['哎哟！', '干嘛戳我～', '戳我做什么呀', '吓我一跳'],
    grab: ['放我下来！', '呜哇——', '别拎我呀', '脚离地了！'],
    drop: ['呼，落地了', '站稳了！', '差点摔着', '谢谢放我下来'],
    idle: ['有点无聊…', '你在忙什么呀', '我在这儿呢', '理理我嘛'],
    wake: ['唔…睡醒了', '啊——睡得好饱', '呼啊…几点了', '醒啦醒啦'],
    sleepy: ['困了…', '眼皮好重…', '想睡一会儿…', '打个哈欠～'],
    bug: ['抓到啦！', '嘿嘿，跑不掉', '看我厉害吧！', '小虫子归我了'],
    walk: ['走走走～', '散步去咯', '活动活动筋骨', '溜达溜达'],
    pet: ['你好呀！', '我是新来的～', '第一次见面，多多指教', '嘿，我上桌啦'],
  },
  lively: {
    '*': ['嘿哈！', '我超有精神的！'],
    pat: ['哇——再来再来！', '超级舒服！', '我飘起来了～', '哈哈，痒痒的'],
    poke: ['哇啊！你干嘛！', '我跳！我跳！', '来玩吗来玩吗！', '嘿！吓不到我的'],
    grab: ['哇呀呀——飞起来了！', '我要飞啦！', '好高好高！', '放开放开～'],
    drop: ['砰！落地啦！', '再来一次！', '我稳稳的！', '好玩好玩！'],
    idle: ['好无聊啊！来玩嘛！', '我要闹了哦～', '快点看我一眼！', '有谁在吗——'],
    wake: ['我醒了！冲鸭！', '睡饱了，超有力气！', '今天也要元气满满！', '起床！'],
    sleepy: ['就算困也要玩…', '呼…不行了…', '再玩五分钟…', '打不住了…'],
    bug: ['抓到啦！我厉害吧！', '看我的！', '啪！抓住！', '我可是捕虫高手'],
    walk: ['冲呀——', '跑起来跑起来！', '我要逛遍整张桌子！', '出发出发！'],
    pet: ['我来啦——！', '今天也要一起玩哦！', '嘿嘿，我上桌啦！', '准备好了吗！'],
  },
  gentle: {
    '*': ['嗯…', '我在的哦'],
    pat: ['谢谢你…', '很温柔呢', '舒服得想眯眼', '嗯…好温暖'],
    poke: ['呀…', '怎么啦？', '轻一点点哦', '我在这儿呢'],
    grab: ['请…轻一点', '呀，被抱起来了', '有点怕高…', '慢一点…'],
    drop: ['谢谢你放我下来', '嗯，站稳了', '还好还好', '慢慢来就好'],
    idle: ['有空的话…陪陪我', '我想你了', '安静地待着也不错', '你忙吧，我在'],
    wake: ['早安…', '睡得好香', '嗯…醒来了', '今天天气好吗'],
    sleepy: ['有点困了…', '我想休息一下', '闭会儿眼…', '慢慢睡着了…'],
    bug: ['小心点哦，我抓住了', '已经没事了', '交给我吧', '跑不掉的'],
    walk: ['慢慢走一走', '四处看看', '散步很舒服', '走一会儿…'],
    pet: ['很高兴见到你', '我会乖乖的', '以后请多关照', '你好呀'],
  },
  sleepy: {
    '*': ['唔…', '别吵…'],
    pat: ['唔…随便你', '舒服…就一下下', '不想动…', '嗯…'],
    poke: ['唔…干嘛…', '别戳…', '困…', '让我躺着…'],
    grab: ['唔…别动我…', '放…放下来…', '好麻烦…', '我要瘫着…'],
    drop: ['终于…', '就这样…别动…', '唔…继续躺', '好累…'],
    idle: ['就这样躺着挺好…', '什么也不想干…', '唔…好困…', '别管我…'],
    wake: ['唔…还想睡…', '再睡五分钟…', '谁把我吵醒了…', '唔…'],
    sleepy: ['已经睡着了…', '呼…呼…', '撑不住了…', '躺平…'],
    bug: ['唔…懒得追', '抓到了…累', '就这样吧…', '好麻烦但抓到了'],
    walk: ['唔…走不动了', '慢慢挪…', '不想走…', '挪两步…'],
    pet: ['唔…你好…', '我躺着了…', '随便吧…', '嗯…来了'],
  },
  clingy: {
    '*': ['你在哪～', '陪陪我嘛'],
    pat: ['最喜欢你了！', '不要停嘛～', '还要还要！', '你的手好暖'],
    poke: ['是我吗是我吗！', '你在叫我吗！', '嘿嘿，我一直在看你', '想要抱抱～'],
    grab: ['不要放开我嘛…', '抱着我！', '这样也很好！', '别松手～'],
    drop: ['啊…离开了…', '再抱一下嘛', '我会想你的', '回来回来～'],
    idle: ['我好想你…', '你去哪了呀', '别丢下我一个人', '快回来嘛～'],
    wake: ['你还在吗？', '一睁眼就想看到你', '嗯…你在就好', '睡醒第一件事就是找你'],
    sleepy: ['抱着你才睡得着…', '别走哦…', '陪我睡…', '唔…握着我的手'],
    bug: ['我抓到了！快夸我！', '你看你看！', '为你抓的哦！', '夸夸我嘛～'],
    walk: ['我一直跟着你哦', '你走我也走～', '别走太快嘛', '等等我～'],
    pet: ['你来啦！我等你好久了！', '以后一直在一起吧', '嘿嘿，终于见到你', '不要走开哦'],
  },
  quiet: {
    '*': ['……', '嗯。'],
    pat: ['……嗯。', '（眯起眼）', '……谢谢。', '（轻轻蹭了蹭）'],
    poke: ['……？', '。', '（看着你）', '……怎么了。'],
    grab: ['……', '（安静地悬着）', '……放我下来。', '（僵住）'],
    drop: ['……落地了。', '嗯。', '（拍拍灰）', '……好。'],
    idle: ['……', '（安静地待着）', '……我在。', '（看了你一眼）'],
    wake: ['……醒了。', '（揉眼）', '……嗯。', '（坐起来）'],
    sleepy: ['……困。', '（闭眼）', '……晚安。', '（慢慢垂下头）'],
    bug: ['抓到了。', '……解决。', '（放下虫子）', '嗯。'],
    walk: ['……', '（走开）', '……散步。', '（慢慢移动）'],
    pet: ['……你好。', '（点了点头）', '……嗯，我来了。', '（安静地看着你）'],
  },
};

/** 取某事件的候选台词（带上 default / * 的兜底） */
export function linesFor(tone, event) {
  const t = TONES.includes(tone) ? tone : 'default';
  const ev = (event || '').trim();
  // 优先用**这个口吻 + 这个事件**的专属台词。
  // 只有找不到时才逐级兜底 —— 不能再把 default 的同事件台词也拼进来：
  // 那样会把候选池稀释，两套性格的差异被抹平（实测：活泼和默认抽出同一句）。
  const own = LINES[t] && LINES[t][ev];
  if (Array.isArray(own) && own.length) return own.slice();
  const general = LINES[t] && LINES[t]['*'];
  if (Array.isArray(general) && general.length) return general.slice();
  const dflt = LINES.default[ev];
  if (Array.isArray(dflt) && dflt.length) return dflt.slice();
  return (LINES.default['*'] || []).slice();
}

/**
 * 选一句话。
 * @param opt.event   事件名
 * @param opt.tone    性格口吻
 * @param opt.custom  用户自定义台词（有的话优先；空数组则忽略）
 * @param opt.avoid   最近说过的话（尽量不重复）
 * @param opt.rng     随机源（测试可注入固定序列）
 */
export function pickLine(opt = {}) {
  const rng = typeof opt.rng === 'function' ? opt.rng : Math.random;
  const custom = Array.isArray(opt.custom) ? opt.custom.filter((x) => String(x || '').trim()) : [];
  // 自定义台词只在「没有具体事件」或「闲聊」时优先。
  // 否则用户在气泡面板写的那些台词会把**所有**事件回应都盖掉 ——
  // 实测：摸头/挨打/被抓全都只说自定义的第一句，性格与事件全失效。
  const ev = String(opt.event || '');
  const customWins = custom.length && (!ev || ev === 'idle' || ev === '*');
  const pool = customWins ? custom : linesFor(opt.tone, ev);
  if (!pool.length) return '';
  const avoid = new Set((Array.isArray(opt.avoid) ? opt.avoid : []).map((x) => String(x)));
  // 优先挑"最近没说过"的；全说过就退回全池（不能因为避重就一句不说）
  const fresh = pool.filter((x) => !avoid.has(String(x)));
  const use = fresh.length ? fresh : pool;
  const i = Math.floor(Math.abs(Number(rng()) || 0) * use.length) % use.length;
  return String(use[i]);
}

/**
 * 一句台词该显示多久：短句快、长句慢，有上下限。
 * （与 speech.js 的 speechDuration 同一套直觉，但这里给的是"对话"场景的默认值。）
 */
export function lineDuration(text, opt = {}) {
  const min = Number(opt.min) || 1.4;
  const max = Number(opt.max) || 7;
  const perChar = Number(opt.perChar) || 0.14;
  const n = Array.from(String(text == null ? '' : text)).length;
  return Math.max(min, Math.min(max, min + n * perChar));
}

/**
 * 对话状态机要做的事：决定「现在该不该说话」。
 * 单独抽出来是为了好测：不依赖计时器，只算"距离上次说话的间隔"。
 * @param opt.event      当前事件
 * @param opt.now        当前时间戳(ms)
 * @param opt.lastTalkAt 上次说话时间戳(ms)
 * @param opt.cooldownMs 同类事件的冷却时间
 * @param opt.minGapMs   任何两句话之间的最小间隔
 * @param opt.silent     静默模式（完全不说话）
 */
export function shouldSpeak(opt = {}) {
  if (opt.silent) return { ok: false, reason: '已开启静默' };
  if (!opt.event) return { ok: false, reason: '没有事件' };
  const now = Number(opt.now) || 0;
  const last = Number(opt.lastTalkAt) || 0;
  const minGap = Number(opt.minGapMs) || 0;
  if (last && now - last < minGap) return { ok: false, reason: '刚说过话' };
  const cd = Number(opt.cooldownMs) || 0;
  if (last && cd && now - last < cd) return { ok: false, reason: '还在冷却' };
  return { ok: true, reason: '' };
}

/** 性格 -> 口吻（templates.js 的性格名与这里的 tone 对应） */
export function toneOf(personality) {
  const p = String(personality || '').trim();
  if (TONES.includes(p)) return p;
  // 允许中文性格名
  const map = { 活泼: 'lively', 温顺: 'gentle', 贪睡: 'sleepy', 粘人: 'clingy', 静默: 'quiet' };
  if (p === 'lazy') return 'sleepy';   // 兼容旧别名
  return map[p] || 'default';
}
