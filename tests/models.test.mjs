import { ok } from './_harness.mjs';
import { MODELS, listModels } from '../src/main/models.js';

// 每个模型的预处理配置必须显式且正确——三者互不相同，极易改错
const EXPECT = {
  silueta:      { size: 320,  divide: 'max', mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], preprocess: 'resize' },
  isnetGeneral: { size: 1024, divide: 255,   mean: [0.5, 0.5, 0.5],       std: [1, 1, 1],             preprocess: 'resize' },
  isnetAnime:   { size: 1024, divide: 1,     mean: [0, 0, 0],             std: [1, 1, 1],             preprocess: 'letterbox' },
};

for (const [id, exp] of Object.entries(EXPECT)) {
  const m = MODELS[id];
  ok(`${id}: 存在`, !!m);
  if (!m) continue;
  ok(`${id}: size=${exp.size}`, m.size === exp.size, 'got ' + m.size);
  ok(`${id}: divide=${JSON.stringify(exp.divide)}`, m.divide === exp.divide, 'got ' + JSON.stringify(m.divide));
  ok(`${id}: mean 正确`, JSON.stringify(m.mean) === JSON.stringify(exp.mean), JSON.stringify(m.mean));
  ok(`${id}: std 正确`, JSON.stringify(m.std) === JSON.stringify(exp.std), JSON.stringify(m.std));
  ok(`${id}: 声明 Apache-2.0`, m.license === 'Apache-2.0', m.license);
  ok(`${id}: 有下载地址`, typeof m.url === 'string' && m.url.startsWith('https://'), m.url);
  ok(`${id}: 有字节数`, typeof m.bytes === 'number' && m.bytes > 1e6, String(m.bytes));
}

// 明确排除不兼容许可的模型
for (const id of Object.keys(MODELS)) {
  const m = MODELS[id];
  ok(`${id}: 不含 AGPL`, !/agpl/i.test(m.license), m.license);
  ok(`${id}: 非 BRIA 付费许可`, !/bria/i.test(m.license), m.license);
}

// listModels 不应泄漏内部字段，但要带 installed 标记
const list = listModels(process.env.TEMP || '/tmp');
ok('listModels 返回 3 个模型', list.length === 3, 'n=' + list.length);
ok('listModels 含 installed 字段', list.every((m) => typeof m.installed === 'boolean'));
ok('listModels 含 divide 配置', list.every((m) => m.divide !== undefined));
ok('listModels 含 preprocess 配置', list.every((m) => m.preprocess !== undefined));

// ---------- 姿态模型必须与抠图模型分开 ----------
// 背景：注册表里同时放抠图模型与姿态模型，便于统一下载/校验。
// 但它们是两条不同的推理链路（输入 dtype 都不同），混进抠图下拉框会让抠图失败。
{
  const { MODELS: M, listModels: LM } = await import('../src/main/models.js');
  const cut = LM(process.env.TEMP || '/tmp');
  const pose = LM(process.env.TEMP || '/tmp', { kind: 'pose' });
  ok('默认 listModels 只返回抠图模型', cut.every((m) => (m.kind || 'cutout') === 'cutout'), cut.map((m) => m.id + ':' + m.kind).join(','));
  ok('抠图模型数 = 3', cut.length === 3, 'n=' + cut.length);
  ok('姿态模型单独可查', pose.length >= 1, 'n=' + pose.length);
  ok('姿态模型标了 kind=pose', pose.every((m) => m.kind === 'pose'));
  ok('抠图列表里不含姿态模型', !cut.some((m) => m.id === 'poseMovenet'), cut.map((m) => m.id).join(','));
  ok('姿态模型声明了 int32 输入（用 float 会直接报错）', M.poseMovenet.inputDtype === 'int32', String(M.poseMovenet.inputDtype));
  ok('姿态模型有字节数与 md5', M.poseMovenet.bytes > 1e6 && /^[0-9a-f]{32}$/.test(M.poseMovenet.md5));
}