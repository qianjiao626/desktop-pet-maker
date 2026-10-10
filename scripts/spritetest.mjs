// 测试用「标准立绘」生成器：正面、四肢张开、互不重叠。
// 关键：**图片几何与关键点严格对齐**，否则识别出来的点与画面对不上，
// 会让「微动作」在完全正确的实现下也看起来是错的（这个坑踩过）。
export const SPRITE_W = 400;
export const SPRITE_H = 560;

/** 与图片严格对应的关键点（归一化） */
export const SPRITE_KEYPOINTS = [
  ['nose', 0.50, 0.16], ['leftEye', 0.52, 0.15], ['rightEye', 0.48, 0.15],
  ['leftEar', 0.57, 0.15], ['rightEar', 0.43, 0.15],
  ['leftShoulder', 0.58, 0.31], ['rightShoulder', 0.42, 0.31],
  ['leftElbow', 0.75, 0.45], ['rightElbow', 0.25, 0.45],
  ['leftWrist', 0.88, 0.58], ['rightWrist', 0.12, 0.58],
  ['leftHip', 0.55, 0.65], ['rightHip', 0.45, 0.65],
  ['leftKnee', 0.60, 0.79], ['rightKnee', 0.40, 0.79],
  ['leftAnkle', 0.60, 0.93], ['rightAnkle', 0.40, 0.93],
];

/**
 * 在页面里注册 window.__makeSprite()，返回 dataURL。
 * 用字符串拼接（而不是模板串）是为了避免被外层工具误处理。
 */
export const SPRITE_PAGE_SCRIPT = [
  '(function(){',
  '  window.__makeSprite = function(){',
  '    var W=' + SPRITE_W + ',H=' + SPRITE_H + ';',
  '    var cv=document.createElement("canvas"); cv.width=W; cv.height=H;',
  '    var c=cv.getContext("2d");',
  '    c.strokeStyle="#3a4a66"; c.lineWidth=46; c.lineCap="round";',
  '    c.beginPath(); c.moveTo(0.45*W,0.65*H); c.lineTo(0.40*W,0.93*H); c.stroke();',
  '    c.beginPath(); c.moveTo(0.55*W,0.65*H); c.lineTo(0.60*W,0.93*H); c.stroke();',
  '    c.fillStyle="#4a7ec8";',
  '    c.beginPath(); c.moveTo(0.42*W,0.30*H); c.lineTo(0.58*W,0.30*H); c.lineTo(0.58*W,0.66*H); c.lineTo(0.42*W,0.66*H); c.closePath(); c.fill();',
  '    c.strokeStyle="#4a7ec8"; c.lineWidth=34;',
  '    c.beginPath(); c.moveTo(0.42*W,0.32*H); c.lineTo(0.25*W,0.45*H); c.lineTo(0.12*W,0.58*H); c.stroke();',
  '    c.beginPath(); c.moveTo(0.58*W,0.32*H); c.lineTo(0.75*W,0.45*H); c.lineTo(0.88*W,0.58*H); c.stroke();',
  '    c.fillStyle="#f2c9a8";',
  '    c.beginPath(); c.arc(0.12*W,0.58*H,17,0,Math.PI*2); c.fill();',
  '    c.beginPath(); c.arc(0.88*W,0.58*H,17,0,Math.PI*2); c.fill();',
  '    c.fillRect(0.48*W,0.24*H,0.04*W,0.06*H);',
  '    c.beginPath(); c.arc(0.50*W,0.16*H,44,0,Math.PI*2); c.fill();',
  '    c.fillStyle="#3a2a22"; c.beginPath(); c.arc(0.50*W,0.145*H,46,Math.PI,0); c.fill();',
  '    c.fillStyle="#222";',
  '    c.beginPath(); c.arc(0.48*W,0.165*H,4,0,Math.PI*2); c.fill();',
  '    c.beginPath(); c.arc(0.52*W,0.165*H,4,0,Math.PI*2); c.fill();',
  '    return cv.toDataURL("image/png");',
  '  };',
  '})();',
].join("\n");

/** 由 SPRITE_KEYPOINTS 造一个 51 长的原始数组（模拟模型输出） */
export function spriteRawKeypoints() {
  const names = ['nose','leftEye','rightEye','leftEar','rightEar','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle'];
  const raw = new Array(51).fill(0);
  for (const [n, x, y] of SPRITE_KEYPOINTS) {
    const i = names.indexOf(n);
    if (i < 0) continue;
    raw[i * 3] = y; raw[i * 3 + 1] = x; raw[i * 3 + 2] = 0.9;
  }
  return raw;
}
