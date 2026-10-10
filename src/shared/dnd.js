// 拖拽文件的类型判定（纯函数，便于单测；产品与测试共用同一份规则）
//
// 背景：收到宠物包的人最自然的动作就是把 .petpack 拖进窗口。
// 早期版本只过滤 image/*，拖宠物包会被拒绝并提示"只支持图片文件" —— 新用户会卡在这。
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** 是否宠物包（.petpack / .zip，也兼容 MIME 带 petpack 的情况） */
export function isPetpackFile(f) {
  if (!f) return false;
  const name = String(f.name || '');
  const type = String(f.type || '');
  return /\.(petpack|zip)$/i.test(name) || /petpack/i.test(type);
}

/** 是否图片：优先看 MIME，拿不到 MIME 时回退到扩展名（本地拖拽常常没有 MIME） */
export function isImageFile(f) {
  if (!f) return false;
  const type = String(f.type || '');
  if (/^image\//i.test(type)) return true;
  return IMAGE_EXT.test(String(f.name || ''));
}

/**
 * 把一次拖入的文件分成「宠物包」和「图片」两类
 * 返回值恒定包含两个数组，避免调用方对 undefined 做判断
 */
export function classifyDroppedFiles(files) {
  const packs = [], images = [], others = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (isPetpackFile(f)) packs.push(f);
    else if (isImageFile(f)) images.push(f);
    else others.push(f);
  }
  return { packs, images, others };
}
