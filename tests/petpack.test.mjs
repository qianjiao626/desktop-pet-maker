import { ok } from './_harness.mjs';
import { normalizePack, validatePack, SCHEMA_VERSION } from '../src/shared/petpack.js';

const p = normalizePack({ render: { scale: 99 }, animation: { idle: 'bogus', idleSpeed: 99 }, bubble: { lines: [] } });
ok('scale 上限钳制=4', p.render.scale === 4);
ok('非法 idle 回退', p.animation.idle === 'breathe');
ok('idleSpeed 上限钳制=3', p.animation.idleSpeed === 3);
ok('空台词回退默认', p.bubble.lines.length > 0);
ok('schema 版本', p.schema === SCHEMA_VERSION);

const legacy = normalizePack({ image: 'hero.png', imageSize: { width: 100, height: 120 } });
ok('v1 迁移为单帧', legacy.frames.length === 1 && legacy.frames[0].file === 'hero.png');
ok('v1 画布尺寸迁移', legacy.canvas.width === 100 && legacy.canvas.height === 120);

const multi = normalizePack({ frames: ['a.png', { file: 'b.png', durationMs: 999999 }, { file: '' }] });
ok('字符串帧被接受', multi.frames.length === 2 && multi.frames[0].file === 'a.png');
ok('帧时长上限钳制=5000', multi.frames[1].durationMs === 5000);

ok('校验: 合法包通过', validatePack({ name: 'x', frames: [{ file: 'a.png' }] }).ok);
ok('校验: 无帧报错', !validatePack({ name: 'x', frames: [] }).ok);
ok('校验: 无名称报错', !validatePack({ frames: [{ file: 'a.png' }] }).ok);