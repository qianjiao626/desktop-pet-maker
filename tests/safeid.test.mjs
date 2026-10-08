import { ok } from './_harness.mjs';
import { safeFileName, petPackFileName } from '../src/shared/safeid.js';

// ---- 基本 ----
ok('普通名称不变', safeFileName('mypet') === 'mypet');
ok('中文保留', safeFileName('小豆子') === '小豆子', safeFileName('小豆子'));
ok('中英混合保留', safeFileName('小豆子_v2') === '小豆子_v2');

// ---- Windows 非法字符 ----
ok('斜杠被替换', !safeFileName('a/b').includes('/'), safeFileName('a/b'));
ok('反斜杠被替换', !safeFileName('a\\b').includes('\\'), safeFileName('a\\b'));
ok('冒号被替换', safeFileName('C:pet') === 'C_pet', safeFileName('C:pet'));
ok('星号问号被替换', safeFileName('a*b?c') === 'a_b_c', safeFileName('a*b?c'));
ok('引号尖括号竖线被替换', safeFileName('a"b<c>d|e') === 'a_b_c_d_e', safeFileName('a"b<c>d|e'));

// ---- 路径穿越（安全关键）----
ok('路径穿越被消除', !safeFileName('../../etc/passwd').includes('/'), safeFileName('../../etc/passwd'));
ok('路径穿越不残留点点', !safeFileName('../../x').startsWith('.'), safeFileName('../../x'));
ok('Windows 绝对路径被消除', !/[:\\/]/.test(safeFileName('C:\\Windows\\System32')), safeFileName('C:\\Windows\\System32'));
ok('UNC 路径被消除', !safeFileName('\\\\server\\share').includes('\\'), safeFileName('\\\\server\\share'));

// ---- 控制字符 ----
ok('控制字符被移除', safeFileName('a\u0000b\u001fc') === 'abc', JSON.stringify(safeFileName('a\u0000b\u001fc')));
ok('换行被折叠', safeFileName('a\nb') === 'a_b', safeFileName('a\nb'));

// ---- 空白 ----
ok('空白折叠为下划线', safeFileName('a   b') === 'a_b', safeFileName('a   b'));
ok('制表符也处理', safeFileName('a\tb') === 'a_b', safeFileName('a\tb'));

// ---- 首尾点/空格 ----
ok('前导点被去除', safeFileName('.hidden') === 'hidden', safeFileName('.hidden'));
ok('尾部点被去除', safeFileName('abc.') === 'abc', safeFileName('abc.'));
ok('尾部空格被去除', safeFileName('abc   ') === 'abc', safeFileName('abc   '));

// ---- Windows 保留设备名 ----
for (const r of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']) {
  ok('保留名 ' + r + ' 被规避', safeFileName(r) !== r, safeFileName(r));
}
ok('保留名大小写均规避', safeFileName('con') !== 'con', safeFileName('con'));
ok('保留名带扩展名也规避', safeFileName('CON.txt') !== 'CON.txt', safeFileName('CON.txt'));
ok('普通名不受保留名逻辑影响', safeFileName('CONTENT') === 'CONTENT', safeFileName('CONTENT'));

// ---- 限长（关键：不能产生超长文件名）----
{
  const long = 'x'.repeat(500);
  const r = safeFileName(long);
  ok('超长被截断', Array.from(r).length <= 80, Array.from(r).length + ' 字符');
  ok('截断后非空', r.length > 0);
}
{
  const long = '中'.repeat(500);
  const r = safeFileName(long);
  ok('中文超长按码点截断', Array.from(r).length <= 80, Array.from(r).length);
  // 关键：不得产生残缺代理对（乱码）
  ok('截断不产生残缺字符', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r) && !/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r));
}
{
  // 截断恰好落在点结尾时，应再次清理
  const s = 'a'.repeat(79) + '.' + 'b'.repeat(10);
  const r = safeFileName(s);
  ok('截断后不以点结尾', !r.endsWith('.'), JSON.stringify(r.slice(-5)));
}

// ---- 空/异常输入 ----
ok('空串回退', safeFileName('') === 'pet');
ok('null 回退', safeFileName(null) === 'pet');
ok('undefined 回退', safeFileName(undefined) === 'pet');
ok('纯非法字符回退', safeFileName('...') === 'pet', safeFileName('...'));
ok('纯空格回退', safeFileName('   ') === 'pet');
ok('数字正常', safeFileName(12345) === '12345');

// ---- petPackFileName ----
ok('扩展名正确', petPackFileName('小豆子') === '小豆子.petpack', petPackFileName('小豆子'));
ok('扩展名唯一', (petPackFileName('a.petpack').match(/\.petpack/g) || []).length === 1, petPackFileName('a.petpack'));
ok('非法名也安全', !petPackFileName('a/b').includes('/'), petPackFileName('a/b'));

// ---- 关键不变量：任何输入都返回非空、无路径分隔符、有限长度 ----
{
  const inputs = ['', null, undefined, '../../x', 'C:\\a\\b', 'con', 'a'.repeat(999), '中文'.repeat(200), '\u0000\u0001', '...', '/', '\\', '  .  ', 'a/b\\c:d*e?f"g<h>i|j'];
  let bad = 0;
  for (const inp of inputs) {
    const r = safeFileName(inp);
    if (!r || /[\\/:*?"<>|]/.test(r) || Array.from(r).length > 80 || r.endsWith('.') || r.endsWith(' ')) bad++;
  }
  ok('不变量：全部输入均安全', bad === 0, bad + ' 个不合格');
}

// ---- 关键回归：路径穿越不得留下前导点/下划线 ----
// 曾产出 "_.._evil_x" 导致 Windows copyfile EINVAL
{
  const r = safeFileName("../../evil:x");
  ok("路径穿越后无前导点", !r.startsWith("."), JSON.stringify(r));
  ok("路径穿越后无前导下划线", !r.startsWith("_"), JSON.stringify(r));
  ok("路径穿越后内容正确", r === "evil_x", JSON.stringify(r));
  const winPath = safeFileName("C:\\Windows");
  ok("Windows 路径无前导下划线", !winPath.startsWith("_"), JSON.stringify(winPath));

  // 不变量：任何输入都不得以点或下划线开头/结尾，且非空、有限长
  const inputs = ["../../x", "...", ".hidden", "_a_", "a/b\\c", "..\\..\\z", "  .x.  ", "a".repeat(500)];
  let bad = 0;
  const reasons = [];
  for (const inp of inputs) {
    const out = safeFileName(inp);
    if (!out || /^[._]/.test(out) || /[._]$/.test(out) || Array.from(out).length > 80) {
      bad++; reasons.push(JSON.stringify(inp) + "->" + JSON.stringify(out));
    }
  }
  ok("不变量：首尾无点/下划线", bad === 0, reasons.join(", "));
}

// ---- 回归：限长逻辑不得因清理而丢失 ----
ok("英文超长被截断到 80", Array.from(safeFileName("x".repeat(500))).length === 80, String(Array.from(safeFileName("x".repeat(500))).length));
ok("中文超长被截断到 80", Array.from(safeFileName("中".repeat(500))).length === 80, String(Array.from(safeFileName("中".repeat(500))).length));
ok("截断后仍非空", safeFileName("x".repeat(500)).length > 0);
