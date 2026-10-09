// 把「喵喵」「胖橘猫」也统一成圆润萌系风格（原来的细线描边风格与其他不统一）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/shared/png.js";
import { zipCreate } from "../src/shared/zip.js";
import { normalizePack } from "../src/shared/petpack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "examples");
const SIZE = 256;
const sh = (c, k) => [Math.min(255, c[0]*k), Math.min(255, c[1]*k), Math.min(255, c[2]*k)];
const mk = () => ({ px: new Uint8ClampedArray(SIZE*SIZE*4) });

function put(cv, x, y, col, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y*SIZE+x)*4, na = a/255, oa = cv.px[i+3]/255, A = na + oa*(1-na);
  if (A <= 0) return;
  cv.px[i]   = Math.round((col[0]*na + cv.px[i]  *oa*(1-na))/A);
  cv.px[i+1] = Math.round((col[1]*na + cv.px[i+1]*oa*(1-na))/A);
  cv.px[i+2] = Math.round((col[2]*na + cv.px[i+2]*oa*(1-na))/A);
  cv.px[i+3] = Math.round(A*255);
}
function ell(cv, ox, oy, rx, ry, col, alpha = 255) {
  for (let y = Math.max(0,Math.floor(oy-ry-1)); y <= Math.min(SIZE-1,Math.ceil(oy+ry+1)); y++)
    for (let x = Math.max(0,Math.floor(ox-rx-1)); x <= Math.min(SIZE-1,Math.ceil(ox+rx+1)); x++) {
      const d = Math.hypot((x-ox)/rx, (y-oy)/ry);
      if (d > 1) { const k = Math.min(1,(d-1)*Math.min(rx,ry)); if (k>=1) continue; put(cv,x,y,col,alpha*(1-k)); }
      else put(cv,x,y,col,alpha);
    }
}
function tri(cv, p1, p2, p3, col) {
  const s = (a,b,c) => (a[0]-c[0])*(b[1]-c[1])-(b[0]-c[0])*(a[1]-c[1]);
  const minX=Math.floor(Math.min(p1[0],p2[0],p3[0])-1), maxX=Math.ceil(Math.max(p1[0],p2[0],p3[0])+1);
  const minY=Math.floor(Math.min(p1[1],p2[1],p3[1])-1), maxY=Math.ceil(Math.max(p1[1],p2[1],p3[1])+1);
  for (let y=minY;y<=maxY;y++) for (let x=minX;x<=maxX;x++) {
    const d1=s([x,y],p1,p2), d2=s([x,y],p2,p3), d3=s([x,y],p3,p1);
    if ((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0)) continue;
    put(cv,x,y,col,255);
  }
}

/** 圆润小猫：大圆脸 + 三角耳 + 尾巴 */
function drawCat(spec, o = {}) {
  const { squash = 1, bob = 0, arm = 0, blink = false, tail = 0 } = o;
  const cv = mk(), cx = SIZE/2, cy = SIZE/2 + 6 + bob;
  const rx = SIZE*0.315, ry = SIZE*0.325*squash;
  const dark = sh(spec.body, 0.85);

  // 尾巴（在身后）
  for (let i = 0; i <= 16; i++) {
    const k = i/16;
    ell(cv, cx + rx*(0.86 + k*0.44), cy + ry*(0.30 - k*0.62) + Math.sin(k*Math.PI*1.1)*8 + tail*7,
      rx*(0.115 - k*0.045), ry*(0.115 - k*0.045), dark);
  }
  // 耳朵
  for (const s of [-1,1]) {
    tri(cv, [cx+s*rx*0.66, cy-ry*0.74], [cx+s*rx*0.92, cy-ry*1.30], [cx+s*rx*0.24, cy-ry*0.92], dark);
    tri(cv, [cx+s*rx*0.62, cy-ry*0.80], [cx+s*rx*0.80, cy-ry*1.16], [cx+s*rx*0.38, cy-ry*0.90], spec.accent);
  }
  // 手脚
  ell(cv, cx-rx*0.96, cy+ry*0.24+arm*8, rx*0.175, ry*0.20, dark);
  ell(cv, cx+rx*0.96, cy+ry*0.24-arm*8, rx*0.175, ry*0.20, dark);
  ell(cv, cx-rx*0.42, cy+ry*0.92, rx*0.25, ry*0.155, dark);
  ell(cv, cx+rx*0.42, cy+ry*0.92, rx*0.25, ry*0.155, dark);
  // 身体
  ell(cv, cx, cy, rx*1.045, ry*1.045, dark);
  ell(cv, cx, cy, rx, ry, spec.body);
  ell(cv, cx-rx*0.20, cy-ry*0.34, rx*0.60, ry*0.50, sh(spec.body,1.10), 115);
  ell(cv, cx, cy+ry*0.34, rx*0.50, ry*0.38, spec.belly, 225);
  // 眼睛
  const ex = rx*0.32, ey = cy-ry*0.16;
  if (blink) { for (const s of [-1,1]) for (let x=-1;x<=1;x++) ell(cv, cx+s*ex+x*2, ey, rx*0.10, ry*0.026, [42,38,52]); }
  else for (const s of [-1,1]) {
    ell(cv, cx+s*ex, ey, rx*0.093, ry*0.108, [34,32,44]);
    ell(cv, cx+s*ex-rx*0.030, ey-ry*0.042, rx*0.034, ry*0.040, [255,255,255]);
    ell(cv, cx+s*ex+rx*0.028, ey+ry*0.040, rx*0.016, ry*0.019, [255,255,255], 175);
  }
  // 腮红 + 鼻子 + 嘴
  ell(cv, cx-rx*0.58, cy+ry*0.10, rx*0.13, ry*0.075, spec.accent, 165);
  ell(cv, cx+rx*0.58, cy+ry*0.10, rx*0.13, ry*0.075, spec.accent, 165);
  ell(cv, cx, cy+ry*0.13, rx*0.052, ry*0.040, [120, 72, 82], 230);
  for (let x=-1;x<=1;x++) {
    ell(cv, cx-rx*0.075+x, cy+ry*0.20, rx*0.034, ry*0.028, [110,68,78], 200);
    ell(cv, cx+rx*0.075+x, cy+ry*0.20, rx*0.034, ry*0.028, [110,68,78], 200);
  }
  // 胡须
  for (const s of [-1,1]) for (const dy of [-6, 2]) {
    for (let i = 0; i <= 8; i++) {
      const k = i/8;
      ell(cv, cx+s*(rx*0.74+k*rx*0.36), cy+ry*0.22+dy*k, rx*0.014, ry*0.014, sh(spec.body,0.72), 200);
    }
  }
  return cv.px;
}

const toPNG = (px) => encodePNG(SIZE, SIZE, Buffer.from(px.buffer, px.byteOffset, px.length));
const FRAMES = [
  { o: { }, dur: 190 },
  { o: { squash: 1.045, bob: -3, arm: 0.5, tail: 0.5 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, arm: 0.1, tail: 0.15 }, dur: 190 },
  { o: { squash: 1.06, bob: -4, arm: -0.5, tail: -0.5 }, dur: 190 },
  { o: { squash: 1.03, bob: -2, tail: -0.2 }, dur: 190 },
  { o: { squash: 1.02, bob: -1, blink: true, tail: 0.1 }, dur: 300 },
];

const CATS = [
  { name: '喵喵', body: [252, 200, 138], belly: [255, 240, 215], accent: [255, 152, 162],
    lines: ['喵～', '要不要摸摸我？', '本喵今天也很可爱'] },
  { name: '胖橘猫', body: [248, 172, 96], belly: [255, 232, 196], accent: [255, 146, 156],
    lines: ['喵～', '今天的阳光真好', '摸摸我嘛'] },
];

for (const spec of CATS) {
  const files = FRAMES.map((f, i) => ({ name: 'frame_' + String(i).padStart(3,'0') + '.png', data: toPNG(drawCat(spec, f.o)) }));
  const pack = normalizePack({
    id: 'example-' + spec.name, name: spec.name, author: '桌宠制作器',
    frames: files.map((f, i) => ({ file: f.name, durationMs: FRAMES[i].dur })),
    canvas: { width: SIZE, height: SIZE },
    render: { scale: 0.3 },
    animation: { idle: 'play', idleSpeed: 1, fps: 5, click: 'bounce', hover: 'grow' },
    physics: { gravity: 1.2, bounce: 0.55, roam: true, roamSpeed: 1 },
    bubble: { enabled: true, lines: spec.lines },
    behavior: { startCorner: 'bottom-right', keepAbove: true },
  });
  fs.writeFileSync(path.join(OUT, spec.name + '.petpack'), zipCreate([{ name:'pet.json', data: JSON.stringify(pack,null,2) }, ...files]));
  console.log('已重做: ' + spec.name);
}
