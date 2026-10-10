// 身体识别 端到端：真实 UI + 真实模型
import { app, BrowserWindow } from "electron";
import path from "node:path"; import fs from "node:fs";
import { registerIpc } from "../src/main/main.js";
const ROOT = process.cwd();
let pass=0, fail=0;
const log=(m)=>process.stdout.write(m+"\n");
const check=(n,c,e="")=>{if(c){pass++;log("PASS  "+n+(e?"  ("+e+")":""))}else{fail++;log("FAIL  "+n+"  :: "+e)}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT,"src","preload","preload.cjs"), contextIsolation:true, nodeIntegration:false, offscreen:true }});
  const page = path.join(ROOT,"src","maker","index.html");
  await win.loadFile(page);
  await sleep(1500);
  const js=(c)=>win.webContents.executeJavaScript(c);

  // UI 元素
  check("「身体」标签页存在", await js(`!!document.querySelector('.tab[data-tab="body"]')`));
  check("身体面板存在", await js(`!!document.querySelector('.tabpane[data-pane="body"]')`));
  check("识别按钮存在", await js(`!!document.querySelector('#btnPoseRun')`));
  check("引导文案已渲染", (await js(`(document.querySelector('#poseGuide')||{}).textContent||''`)).includes("正面"), await js(`(document.querySelector('#poseGuide')||{}).textContent||''`).then?.(x=>x)||"");
  const tag = await js(`document.querySelector('#poseTag').textContent`);
  check("模型状态标签有内容", !!tag, tag);

  // 切换 tab 真的显示面板
  await js(`document.querySelector('.tab[data-tab="body"]').click()`);
  await sleep(300);
  check("点击后身体面板可见", await js(`document.querySelector('.tabpane[data-pane="body"]').classList.contains('active')`));

  // 注入真实照片作为当前帧，然后点识别
  const img = fs.readFileSync(path.join(process.env.TEMP,"std.jpg")).toString("base64");
  const injected = await js(`(async () => {
    const dataUrl = 'data:image/jpeg;base64,${img}';
    const img2 = new Image();
    await new Promise((ok,no)=>{img2.onload=ok;img2.onerror=no;img2.src=dataUrl;});
    const cv = document.createElement('canvas'); cv.width=img2.width; cv.height=img2.height;
    cv.getContext('2d').drawImage(img2,0,0);
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height);
    window.__poseTestFrames = window.__poseTestFrames || [];
    return { w: cv.width, h: cv.height };
  })()`);
  check("测试图可解码", injected.w>0, injected.w+"x"+injected.h);

  // 直接走 IPC 验证识别链路（UI 里的按钮依赖 state.frames，这里先验证 IPC）
  const r = await js(`window.api.poseEstimate('data:image/jpeg;base64,${img}')`);
  check("IPC 识别成功", !!(r && r.ok), JSON.stringify(r&&r.errors||"").slice(0,80));
  if (r && r.ok) {
    check("返回 17 个关键点", r.keypoints.length===17, "n="+r.keypoints.length);
    check("返回素材检查结果", !!(r.material && r.material.parts), "");
    check("素材结论可读", typeof r.material.summary==="string" && r.material.summary.length>0, r.material.summary);
    check("图片尺寸正确回传", r.srcWidth>0 && r.srcHeight>0, r.srcWidth+"x"+r.srcHeight);
  }
  // 模型信息
  const info = await js(`window.api.poseModelInfo()`);
  check("模型信息含 installed", typeof info.installed==="boolean", String(info.installed));
  check("模型信息含引导", Array.isArray(info.guide) && info.guide.length>=4, "n="+(info.guide||[]).length);
  check("模型信息含动作列表", Array.isArray(info.motions) && info.motions.length>=4, "n="+(info.motions||[]).length);

  log("==== POSE UI E2E: "+pass+"/"+(pass+fail)+" ====");
  try{win.destroy()}catch{}
  app.exit(fail?1:0);
});
