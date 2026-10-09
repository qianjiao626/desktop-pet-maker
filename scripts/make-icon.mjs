// 生成应用图标（.png 多尺寸 + .ico），形象与内置「小蓝机器人」一致
// 输出：src/assets/icon.png (512)、icon-256.png、icon.ico
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/shared/png.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "src", "assets");
fs.mkdirSync(OUT, { recursive: true });

const P = { dark:[70,92,200], body:[100,124,234], light:[128,152,246], visor:[24,26,50], rim:[14,16,34], cyan:[122,230,238] };

function render(SIZE) {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  const put = (x, y, col, a) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
    const i = (y * SIZE + x) * 4, na = a / 255, oa = px[i+3] / 255, A = na + oa * (1 - na);
    if (A <= 0) return;
    px[i]   = Math.round((col[0]*na + px[i]  *oa*(1-na))/A);
    px[i+1] = Math.round((col[1]*na + px[i+1]*oa*(1-na))/A);
    px[i+2] = Math.round((col[2]*na + px[i+2]*oa*(1-na))/A);
    px[i+3] = Math.round(A*255);
  };
  const ell = (ox, oy, rx, ry, col, alpha = 255) => {
    for (let y = Math.max(0, Math.floor(oy-ry-1)); y <= Math.min(SIZE-1, Math.ceil(oy+ry+1)); y++)
      for (let x = Math.max(0, Math.floor(ox-rx-1)); x <= Math.min(SIZE-1, Math.ceil(ox+rx+1)); x++) {
        const d = Math.hypot((x-ox)/rx, (y-oy)/ry);
        if (d > 1) { const k = Math.min(1,(d-1)*Math.min(rx,ry)); if (k>=1) continue; put(x,y,col,alpha*(1-k)); }
        else put(x,y,col,alpha);
      }
  };
  const rrect = (x0, y0, w, h, r, col) => {
    for (let y = Math.max(0,Math.floor(y0-1)); y <= Math.min(SIZE-1,Math.ceil(y0+h+1)); y++)
      for (let x = Math.max(0,Math.floor(x0-1)); x <= Math.min(SIZE-1,Math.ceil(x0+w+1)); x++) {
        const cx = Math.min(Math.max(x, x0+r), x0+w-r), cy = Math.min(Math.max(y, y0+r), y0+h-r);
        const d = Math.hypot(x-cx, y-cy);
        if (d > r) continue;
        const inside = (x >= x0+r && x <= x0+w-r) || (y >= y0+r && y <= y0+h-r);
        put(x, y, col, inside ? 255 : Math.min(255, (r-d)*255));
      }
  };
  const seg = (x1,y1,x2,y2,th,col) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2-x1,y2-y1)*2));
    for (let i=0;i<=steps;i++){ const k=i/steps; ell(x1+(x2-x1)*k, y1+(y2-y1)*k, th/2, th/2, col); }
  };

  const s = SIZE / 256;
  const cx = SIZE/2, cy = SIZE/2 - 4*s;
  const headR = 66*s, headCY = cy - 20*s;
  const bodyRX = 58*s, bodyRY = 50*s, bodyCY = cy + 48*s;

  // 脚
  for (const sg of [-1,1]) { ell(cx + sg*bodyRX*0.56, bodyCY + bodyRY*0.86, bodyRX*0.34, bodyRY*0.40, P.dark);
                             ell(cx + sg*bodyRX*0.56, bodyCY + bodyRY*0.84, bodyRX*0.30, bodyRY*0.34, P.body); }
  // 手
  for (const sg of [-1,1]) { ell(cx + sg*(bodyRX*0.94 + headR*0.16), bodyCY - bodyRY*0.10, bodyRX*0.26, bodyRX*0.28, P.dark);
                             ell(cx + sg*(bodyRX*0.94 + headR*0.16), bodyCY - bodyRY*0.12, bodyRX*0.225, bodyRX*0.245, P.body); }
  // 身体
  ell(cx, bodyCY, bodyRX*1.05, bodyRY*1.05, P.dark);
  ell(cx, bodyCY, bodyRX, bodyRY, P.body);
  ell(cx - bodyRX*0.22, bodyCY - bodyRY*0.40, bodyRX*0.52, bodyRY*0.42, P.light, 90);
  // 头
  ell(cx, headCY, headR*1.045, headR*0.985, P.dark);
  ell(cx, headCY, headR, headR*0.94, P.body);
  ell(cx - headR*0.26, headCY - headR*0.40, headR*0.58, headR*0.44, P.light, 110);
  // 面罩
  const vw = headR*1.45, vh = headR*0.85;
  const vx = cx - vw/2, vy = headCY - vh*0.44;
  rrect(vx - 2.5*s, vy - 2.5*s, vw + 5*s, vh + 5*s, vh*0.33, P.rim);
  rrect(vx, vy, vw, vh, vh*0.30, P.visor);
  // >_ 符号
  const sh = vh*0.40, sx = vx + vw*0.17, sy = vy + vh*0.50, stem = sh*0.72;
  seg(sx, sy - sh*0.44, sx + stem, sy, sh*0.30, P.cyan);
  seg(sx, sy + sh*0.44, sx + stem, sy, sh*0.30, P.cyan);
  seg(sx + stem*1.28, sy + sh*0.44, sx + stem*1.28 + sh*0.72, sy + sh*0.44, sh*0.28, P.cyan);
  return px;
}

function png(size) { return encodePNG(size, size, Buffer.from(render(size))); }

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(s => ({ size: s, data: png(s) }));
fs.writeFileSync(path.join(OUT, "icon-256.png"), pngs.find(p => p.size === 256).data);
fs.writeFileSync(path.join(OUT, "icon.png"), pngs.find(p => p.size === 256).data);

// 组装 .ico（PNG 压缩格式，Vista+ 支持）
function buildICO(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const dirEntries = [], blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0; d[3] = 0;
    d.writeUInt16LE(1, 4);   // color planes
    d.writeUInt16LE(32, 6);  // bpp
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    dirEntries.push(d); blobs.push(e.data);
  }
  return Buffer.concat([header, ...dirEntries, ...blobs]);
}
fs.writeFileSync(path.join(OUT, "icon.ico"), buildICO(pngs));
console.log("已生成图标: icon.png (256), icon.ico (" + sizes.join("/") + ")");
