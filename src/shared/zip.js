// 极简 ZIP 读写，零第三方依赖
// 写出：STORE(0) 不压缩；读入：支持 STORE(0) 与 DEFLATE(8)
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

/** entries: [{ name: string, data: Buffer|string }] -> Buffer */
export function zipCreate(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cd, eocd]);
}

/**
 * 流式写 zip：边读边写，不在内存里攒整个包。
 *
 * 为什么需要：zipCreate 会把所有内容拼成一个大 Buffer。
 * 导出整个宠物库时总量可能几百 MB，全放内存有 OOM 风险。
 * 这里保持同样的 zip 结构（STORE 不压缩），但直接写到文件流。
 *
 * @param {Array<{name, getData:()=>Buffer|Promise<Buffer>}>} entries
 *   getData 用函数而不是直接给 Buffer —— 这样每个文件是"用到才读"，
 *   峰值内存只有一个文件的大小。
 * @param {string} outPath
 * @returns {Promise<{bytes:number, count:number}>}
 */
export async function zipWriteToFile(entries, outPath) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const list = Array.isArray(entries) ? entries : [];
  const { time, date } = dosDateTime();
  // 先写临时文件，成功后再 rename（原子写入，中途失败不留半包）
  const tmp = outPath + '.tmp-' + process.pid;
  const fh = fs.openSync(tmp, 'w');
  const central = [];
  let offset = 0;
  try {
    for (const e of list) {
      const name = Buffer.from(String(e.name), 'utf8');
      // 内容来源支持三种（缺一不可，否则会静默写成空文件）：
      //   1) e.data 是 Buffer
      //   2) e.data 是字符串 -> 按 utf8 编码（README.txt 就是字符串！
      //      曾经漏了这条分支，导致 README 在包里是 0 字节 —— 实测读回长度 0）
      //   3) e.getData() 惰性取（大文件用，避免一次性把所有内容读进内存）
      let data;
      if (Buffer.isBuffer(e.data)) data = e.data;
      else if (typeof e.data === 'string') data = Buffer.from(e.data, 'utf8');
      else if (typeof e.getData === 'function') data = await e.getData();
      else data = Buffer.alloc(0);
      if (!Buffer.isBuffer(data)) data = Buffer.from(data == null ? '' : String(data), 'utf8');
      const crc = crc32(data);

      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0x0800, 6);
      lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(time, 10);
      lh.writeUInt16LE(date, 12);
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(name.length, 26);
      lh.writeUInt16LE(0, 28);
      fs.writeSync(fh, lh);
      fs.writeSync(fh, name);
      fs.writeSync(fh, data);

      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(time, 12);
      ch.writeUInt16LE(date, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(data.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(name.length, 28);
      ch.writeUInt16LE(0, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, name);

      offset += lh.length + name.length + data.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(list.length, 8);
    eocd.writeUInt16LE(list.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    fs.writeSync(fh, cd);
    fs.writeSync(fh, eocd);
  } finally {
    fs.closeSync(fh);
  }
  fs.renameSync(tmp, outPath);
  return { bytes: offset + central.reduce((s, b) => s + b.length, 0) + 22, count: list.length };
}
/** Buffer -> [{ name, data: Buffer }] */
export function zipRead(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到中央目录）');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('不支持的压缩方式: ' + method);

    if (!name.endsWith('/')) out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}