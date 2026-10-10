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
// ---------- zipWriteToFile：流式写（导出宠物库用）----------
// 关键回归：**字符串内容必须被正确编码写入**。
// 曾经只处理 Buffer，导致 README.txt 在包里是 0 字节（实测读回长度 0）。
{
  const { zipWriteToFile } = await import('../src/shared/zip.js');
  const fs2 = await import('node:fs');
  const os2 = await import('node:os');
  const path2 = await import('node:path');
  const mk = () => path2.join(os2.tmpdir(), 'zipwt-' + Math.random().toString(36).slice(2) + '.zip');

  // 1) 字符串内容
  {
    const out = mk();
    await zipWriteToFile([{ name: 'a.txt', data: 'hello 世界' }], out);
    const back = zipRead(fs2.readFileSync(out));
    const got = back.find((e) => e.name === 'a.txt').data.toString('utf8');
    ok('流式写：字符串内容被正确编码', got === 'hello 世界', JSON.stringify(got));
    ok('流式写：字符串长度非 0（防 0 字节回归）', got.length > 0, 'len=' + got.length);
    fs2.unlinkSync(out);
  }
  // 2) Buffer 内容
  {
    const out = mk();
    await zipWriteToFile([{ name: 'b.bin', data: Buffer.from([1, 2, 3, 4]) }], out);
    const back = zipRead(fs2.readFileSync(out));
    ok('流式写：Buffer 内容正确', back.find((e) => e.name === 'b.bin').data.length === 4);
    fs2.unlinkSync(out);
  }
  // 3) 惰性取值（大文件路径）
  {
    const out = mk();
    let called = 0;
    await zipWriteToFile([{ name: 'c.txt', getData: () => { called++; return Buffer.from('lazy'); } }], out);
    const back = zipRead(fs2.readFileSync(out));
    ok('流式写：getData 惰性取值可用', back.find((e) => e.name === 'c.txt').data.toString() === 'lazy');
    ok('流式写：getData 确实被调用', called === 1, 'called=' + called);
    fs2.unlinkSync(out);
  }
  // 4) 多条目 + 中文名
  {
    const out = mk();
    await zipWriteToFile([
      { name: 'README.txt', data: '说明' },
      { name: '北极熊.petpack', data: Buffer.from([9, 9]) },
    ], out);
    const back = zipRead(fs2.readFileSync(out));
    ok('流式写：多条目都被保留', back.length === 2, 'n=' + back.length);
    ok('流式写：中文条目名保留', back.some((e) => e.name === '北极熊.petpack'), back.map((e) => e.name).join(','));
    fs2.unlinkSync(out);
  }
  // 5) 返回的字节数要与实际文件大小一致（否则界面上显示的体积是错的）
  {
    const out = mk();
    const r = await zipWriteToFile([{ name: 'a.txt', data: 'abc' }], out);
    ok('流式写：返回字节数等于文件大小', r.bytes === fs2.statSync(out).size, `${r.bytes} vs ${fs2.statSync(out).size}`);
    ok('流式写：返回条目数正确', r.count === 1);
    fs2.unlinkSync(out);
  }
  // 6) 空列表也要产出一个合法（空）zip，不能崩
  {
    const out = mk();
    const r = await zipWriteToFile([], out);
    ok('流式写：空列表不崩', r.count === 0 && fs2.existsSync(out));
    ok('流式写：空 zip 仍可被读（0 条目）', zipRead(fs2.readFileSync(out)).length === 0);
    fs2.unlinkSync(out);
  }
}