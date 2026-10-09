// 把剩余 3 只细线稿（小企鹅 / 小黄鸭 / 咚咚）统一为圆润萌系
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../src/shared/png.js";
import { zipCreate } from "../src/shared/zip.js";
import { normalizePack } from "../src/shared/petpack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "examples");
const SIZE = 256;
const sh = (c,k)=>[Math.min(255,c[0]*k),Math.min(255,c[1]*k),Math.min(255,c[2]*k)];
const mk = () => ({ px: new Uint8ClampedArray(SIZE*SIZE*4) });

function put(cv,x,y,col,a){
  if(x<0||y<0||x>=SIZE||y>=SIZE||a<=0)return;
  const i=(y*SIZE+x)*4,na=a/255,oa=cv.px[i+3]/255,A=na+oa*(1-na);
  if(A<=0)return;
  cv.px[i]=Math.round((col[0]*na+cv.px[i]*oa*(1-na))/A);
  cv.px[i+1]=Math.round((col[1]*na+cv.px[i+1]*oa*(1-na))/A);
  cv.px[i+2]=Math.round((col[2]*na+cv.px[i+2]*oa*(1-na))/A);
  cv.px[i+3]=Math.round(A*255);
}
function ell(cv,ox,oy,rx,ry,col,alpha=255){
  for(let y=Math.max(0,Math.floor(oy-ry-1));y<=Math.min(SIZE-1,Math.ceil(oy+ry+1));y++)
    for(let x=Math.max(0,Math.floor(ox-rx-1));x<=Math.min(SIZE-1,Math.ceil(ox+rx+1));x++){
      const d=Math.hypot((x-ox)/rx,(y-oy)/ry);
      if(d>1){const k=Math.min(1,(d-1)*Math.min(rx,ry));if(k>=1)continue;put(cv,x,y,col,alpha*(1-k));}
      else put(cv,x,y,col,alpha);
    }
}
function tri(cv,p1,p2,p3,col,alpha=255){
  const s=(a,b,c)=>(a[0]-c[0])*(b[1]-c[1])-(b[0]-c[0])*(a[1]-c[1]);
  const minX=Math.floor(Math.min(p1[0],p2[0],p3[0])-1),maxX=Math.ceil(Math.max(p1[0],p2[0],p3[0])+1);
  const minY=Math.floor(Math.min(p1[1],p2[1],p3[1])-1),maxY=Math.ceil(Math.max(p1[1],p2[1],p3[1])+1);
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const d1=s([x,y],p1,p2),d2=s([x,y],p2,p3),d3=s([x,y],p3,p1);
    if((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0))continue;
    put(cv,x,y,col,alpha);
  }
}

function drawPet(spec,o={}){
  const {squash=1,bob=0,arm=0,blink=false,tail=0}=o;
  const cv=mk(),cx=SIZE/2,cy=SIZE/2+6+bob,rx=SIZE*0.315,ry=SIZE*0.325*squash,dark=sh(spec.body,0.85);

  if(spec.tail)for(let i=0;i<=16;i++){const k=i/16;
    ell(cv,cx+rx*(0.86+k*0.44),cy+ry*(0.30-k*0.62)+Math.sin(k*Math.PI*1.1)*8+tail*7,rx*(0.115-k*0.045),ry*(0.115-k*0.045),dark);}

  if(spec.ears==='round'){for(const s of[-1,1]){ell(cv,cx+s*rx*0.62,cy-ry*0.88,rx*0.19,ry*0.24,dark);ell(cv,cx+s*rx*0.62,cy-ry*0.88,rx*0.115,ry*0.145,spec.accent);}}
  else if(spec.ears==='horn'){for(const s of[-1,1])for(let i=0;i<=10;i++){const k=i/10;
    ell(cv,cx+s*rx*(0.34+k*0.06),cy-ry*(0.86+k*0.36),rx*(0.135-k*0.075),ry*(0.135-k*0.070),spec.accent);}}
  else if(spec.ears==='shell'){ // 乌龟壳的头顶鼓包
    for(const s of[-1,1]) ell(cv,cx+s*rx*0.44,cy-ry*0.90,rx*0.16,ry*0.16,sh(spec.shell,1.0));
  }

  // 壳（画在身体后面）
  if(spec.shell){ ell(cv,cx,cy+ry*0.06,rx*1.16,ry*1.02,sh(spec.shell,0.86));
    ell(cv,cx,cy+ry*0.02,rx*1.00,ry*0.88,spec.shell);
    for(let i=0;i<6;i++){const a=i/6*Math.PI*2;ell(cv,cx+Math.cos(a)*rx*0.52,cy+ry*0.02+Math.sin(a)*ry*0.42,rx*0.16,ry*0.14,sh(spec.shell,0.80));}
  }

  // 手脚
  ell(cv,cx-rx*0.96,cy+ry*0.24+arm*8,rx*0.175,ry*0.20,dark);
  ell(cv,cx+rx*0.96,cy+ry*0.24-arm*8,rx*0.175,ry*0.20,dark);
  ell(cv,cx-rx*0.42,cy+ry*0.92,rx*0.25,ry*0.155,spec.foot||dark);
  ell(cv,cx+rx*0.42,cy+ry*0.92,rx*0.25,ry*0.155,spec.foot||dark);

  // 身体
  ell(cv,cx,cy,rx*1.045,ry*1.045,dark);
  ell(cv,cx,cy,rx,ry,spec.body);
  ell(cv,cx-rx*0.20,cy-ry*0.34,rx*0.60,ry*0.50,sh(spec.body,1.10),115);
  ell(cv,cx,cy+ry*0.34,rx*0.50,ry*0.38,spec.belly,225);

  // 眼睛
  const ex=rx*0.32,ey=cy-ry*0.16;
  if(blink){for(const s of[-1,1])for(let x=-1;x<=1;x++)ell(cv,cx+s*ex+x*2,ey,rx*0.10,ry*0.026,[42,38,52]);}
  else for(const s of[-1,1]){
    ell(cv,cx+s*ex,ey,rx*0.093,ry*0.108,[34,32,44]);
    ell(cv,cx+s*ex-rx*0.030,ey-ry*0.042,rx*0.034,ry*0.040,[255,255,255]);
    ell(cv,cx+s*ex+rx*0.028,ey+ry*0.040,rx*0.016,ry*0.019,[255,255,255],175);
  }
  // 腮红
  ell(cv,cx-rx*0.58,cy+ry*0.10,rx*0.13,ry*0.075,spec.accent,165);
  ell(cv,cx+rx*0.58,cy+ry*0.10,rx*0.13,ry*0.075,spec.accent,165);
  // 喙 / 嘴
  if(spec.beak){ tri(cv,[cx-rx*0.17,cy+ry*0.13],[cx+rx*0.17,cy+ry*0.13],[cx,cy+ry*0.36],spec.beak); }
  else {
    ell(cv,cx,cy+ry*0.13,rx*0.052,ry*0.040,[120,72,82],230);
    for(let x=-1;x<=1;x++){
      ell(cv,cx-rx*0.075+x,cy+ry*0.20,rx*0.034,ry*0.028,[110,68,78],205);
      ell(cv,cx+rx*0.075+x,cy+ry*0.20,rx*0.034,ry*0.028,[110,68,78],205);
    }
  }
  return cv.px;
}

const toPNG = (px) => encodePNG(SIZE,SIZE,Buffer.from(px.buffer,px.byteOffset,px.length));
const FRAMES = [
  { o:{}, dur:190 },
  { o:{ squash:1.045, bob:-3, arm:0.5, tail:0.5 }, dur:190 },
  { o:{ squash:1.02, bob:-1, arm:0.1, tail:0.15 }, dur:190 },
  { o:{ squash:1.06, bob:-4, arm:-0.5, tail:-0.5 }, dur:190 },
  { o:{ squash:1.03, bob:-2, tail:-0.2 }, dur:190 },
  { o:{ squash:1.02, bob:-1, blink:true, tail:0.1 }, dur:300 },
];

const PETS = [
  { name:'小企鹅', body:[58,62,86], belly:[250,250,252], accent:[255,176,180], ears:'round', beak:[250,190,90], foot:[245,178,80],
    lines:['我是小企鹅～','摇摇晃晃～','要一起玩吗？'] },
  { name:'小黄鸭', body:[252,216,96], belly:[255,246,205], accent:[255,170,175], ears:'horn', beak:[248,168,80], foot:[245,160,70],
    lines:['嘎嘎～','我是小黄鸭！','游泳我最行'] },
  { name:'咚咚', body:[168,206,150], belly:[232,242,214], accent:[255,172,168], ears:'shell', shell:[196,150,96], foot:[150,190,132],
    lines:['咚咚咚…我走得慢','壳里最舒服了','慢慢来也没关系'] },
];

for (const spec of PETS) {
  const files = FRAMES.map((f,i)=>({ name:'frame_'+String(i).padStart(3,'0')+'.png', data:toPNG(drawPet(spec,f.o)) }));
  const pack = normalizePack({
    id:'example-'+spec.name, name:spec.name, author:'桌宠制作器',
    frames: files.map((f,i)=>({ file:f.name, durationMs:FRAMES[i].dur })),
    canvas:{ width:SIZE, height:SIZE },
    render:{ scale:0.3 },
    animation:{ idle:'play', idleSpeed:1, fps:5, click:'bounce', hover:'grow' },
    physics:{ gravity:1.2, bounce:0.55, roam:true, roamSpeed:1 },
    bubble:{ enabled:true, lines:spec.lines },
    behavior:{ startCorner:'bottom-right', keepAbove:true },
  });
  fs.writeFileSync(path.join(OUT, spec.name+'.petpack'), zipCreate([{ name:'pet.json', data:JSON.stringify(pack,null,2) }, ...files]));
  console.log('已重做: '+spec.name);
}
