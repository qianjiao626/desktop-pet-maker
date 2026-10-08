import { ok } from './_harness.mjs';
import { zipCreate, zipRead, crc32 } from '../src/shared/zip.js';
import { encodePNG } from '../src/shared/png.js';

const z = zipCreate([{ name: 'a.txt', data: 'hello world' }, { name: 'b.bin', data: Buffer.from([1, 2, 3, 4, 5]) }]);
const r = zipRead(z);
ok('zip 往返', r.length === 2 && r[0].data.toString('utf8') === 'hello world' && r[1].data.length === 5);
ok('crc32 标准向量', crc32(Buffer.from('123456789')).toString(16) === 'cbf43926');
ok('zip 空条目', zipRead(zipCreate([])).length === 0);
ok('zip 中文文件名', zipRead(zipCreate([{ name: '帧_001.png', data: 'x' }]))[0].name === '帧_001.png');

const png = encodePNG(2, 2, Buffer.alloc(2 * 2 * 4, 128));
ok('png 魔数', png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);
ok('png 含 IEND', png.includes(Buffer.from('IEND')));