import { ok } from './_harness.mjs';
import { isPetpackFile, isImageFile, isShareFile, classifyDroppedFiles } from '../src/shared/dnd.js';

// ---------- 宠物包判定 ----------
ok('.petpack 识别为宠物包', isPetpackFile({ name: 'a.petpack', type: '' }) === true);
ok('大写 .PETPACK 识别', isPetpackFile({ name: 'A.PETPACK', type: '' }) === true);
ok('.zip 识别为宠物包', isPetpackFile({ name: 'a.zip', type: '' }) === true);
ok('MIME 含 petpack 也能识别', isPetpackFile({ name: 'x', type: 'application/x-petpack' }) === true);
ok('中文文件名 + .petpack 识别', isPetpackFile({ name: '朋友分享的宠物.petpack', type: '' }) === true);
ok('.png 不是宠物包', isPetpackFile({ name: 'a.png', type: 'image/png' }) === false);
ok('null 安全', isPetpackFile(null) === false);
ok('undefined 安全', isPetpackFile(undefined) === false);
ok('空对象安全', isPetpackFile({}) === false);
ok('名字像但扩展名不对（.petpack.txt）不误判', isPetpackFile({ name: 'a.petpack.txt', type: 'text/plain' }) === false);

// ---------- 图片判定 ----------
ok('image/* MIME 识别', isImageFile({ name: 'x', type: 'image/png' }) === true);
ok('无 MIME 时按扩展名兜底（本地拖拽常见）', isImageFile({ name: 'photo.JPG', type: '' }) === true);
ok('.jpeg 识别', isImageFile({ name: 'a.jpeg', type: '' }) === true);
ok('.webp 识别', isImageFile({ name: 'a.webp', type: '' }) === true);
ok('.gif 识别', isImageFile({ name: 'a.gif', type: '' }) === true);
ok('.bmp 识别', isImageFile({ name: 'a.bmp', type: '' }) === true);
ok('.txt 不是图片', isImageFile({ name: 'a.txt', type: 'text/plain' }) === false);
ok('null 安全', isImageFile(null) === false);

// ---------- 分类 ----------
const r = classifyDroppedFiles([
  { name: 'a.petpack', type: '' },
  { name: 'b.png', type: 'image/png' },
  { name: 'c.zip', type: '' },
  { name: 'd.txt', type: 'text/plain' },
  { name: 'e.jpg', type: '' },
]);
ok('宠物包归入 packs', r.packs.length === 2, 'n=' + r.packs.length);
ok('图片归入 images', r.images.length === 2, 'n=' + r.images.length);
ok('其它归入 others', r.others.length === 1, 'n=' + r.others.length);
ok('三类互斥且总数正确', r.packs.length + r.images.length + r.others.length === 5);
ok('非数组输入安全', JSON.stringify(classifyDroppedFiles(null)) === JSON.stringify({ packs: [], images: [], shares: [], others: [] }));

// ---------- 分享页判定（本轮新增）----------
ok('.html 识别为分享页', isShareFile({ name: 'a.html', type: '' }) === true);
ok('.htm 识别', isShareFile({ name: 'a.htm', type: '' }) === true);
ok('大写 .HTML 识别', isShareFile({ name: 'A.HTML', type: '' }) === true);
ok('text/html MIME 识别', isShareFile({ name: 'x', type: 'text/html' }) === true);
ok('.png 不是分享页', isShareFile({ name: 'a.png', type: 'image/png' }) === false);
ok('null 安全（share）', isShareFile(null) === false);
// 关键：分享页必须归入 shares，不能被当成 others 拒绝（否则收件人拖不动）
{
  const s = classifyDroppedFiles([{ name: '朋友的宠物_share.html', type: '' }]);
  ok('分享页归入 shares', s.shares.length === 1, 'shares=' + s.shares.length);
  ok('分享页不会被当成其它文件', s.others.length === 0);
}
// .petpack 优先级高于 .html（两者都匹配时先当宠物包）
ok('.petpack 优先于分享页', classifyDroppedFiles([{ name: 'a.petpack', type: 'text/html' }]).packs.length === 1);
ok('空数组安全', classifyDroppedFiles([]).packs.length === 0);
// 边界：叫 x.zip 的图片 —— 按扩展名优先归为宠物包（.zip 本就是宠物包合法后缀）
ok('.zip 优先归为宠物包', classifyDroppedFiles([{ name: 'x.zip', type: 'image/png' }]).packs.length === 1);
