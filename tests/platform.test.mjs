import { ok } from './_harness.mjs';
import { startupSwitches, appMenuTemplate, LINUX_TRANSPARENT_SWITCHES } from '../src/shared/platform.js';

// ---------- Linux 透明窗开关 ----------
ok('Linux 需要补透明窗开关', startupSwitches('linux').length > 0, JSON.stringify(startupSwitches('linux')));
ok('Linux 含 enable-transparent-visuals', startupSwitches('linux').includes('enable-transparent-visuals'));
ok('Linux 含 disable-gpu-compositing', startupSwitches('linux').includes('disable-gpu-compositing'));
ok('返回的是副本（改它不影响常量）', (() => {
  const a = startupSwitches('linux'); a.push('x');
  return !LINUX_TRANSPARENT_SWITCHES.includes('x') && startupSwitches('linux').length === LINUX_TRANSPARENT_SWITCHES.length;
})());
ok('默认不开 disable-gpu（多数机器不需要）', !startupSwitches('linux').includes('disable-gpu'));
ok('逃生开关 PETMAKER_DISABLE_GPU=1 才加 disable-gpu',
  startupSwitches('linux', { PETMAKER_DISABLE_GPU: '1' }).includes('disable-gpu'));
ok('逃生开关不影响其他平台', startupSwitches('win32', { PETMAKER_DISABLE_GPU: '1' }).length === 0);

// 非 Linux 平台不得乱加开关（Windows 上加这些会掉帧）
ok('Windows 不加任何开关', startupSwitches('win32').length === 0);
ok('macOS 不加任何开关', startupSwitches('darwin').length === 0);
ok('未知平台安全返回空', startupSwitches('freebsd').length === 0);
ok('无参安全', Array.isArray(startupSwitches(undefined)) && startupSwitches(undefined).length === 0);

// ---------- macOS 应用菜单 ----------
ok('Windows 无应用菜单（保持干净界面）', appMenuTemplate('win32') === null);
ok('Linux 无应用菜单', appMenuTemplate('linux') === null);
const mac = appMenuTemplate('darwin');
ok('macOS 必须有菜单（否则 Cmd+Q 等失效）', Array.isArray(mac) && mac.length > 0);
const roles = JSON.stringify(mac);
for (const role of ['quit', 'hide', 'hideOthers', 'unhide', 'copy', 'paste', 'cut', 'selectAll', 'undo', 'redo', 'minimize']) {
  ok('macOS 菜单含 role=' + role, roles.includes('"' + role + '"'));
}
ok('macOS 菜单首项是应用名', mac[0] && mac[0].label && mac[0].label.includes('桌宠制作器'), mac[0] && mac[0].label);
ok('macOS 菜单可自定义应用名', appMenuTemplate('darwin', 'MyPet')[0].label === 'MyPet');
ok('macOS 菜单项都是合法对象', mac.every((m) => m && typeof m.label === 'string' && Array.isArray(m.submenu)));
