import { ok } from './_harness.mjs';
import { pickAreaForBounds, rectContains, areaChanged } from '../src/shared/displays.js';

// 双屏：主屏 1920x1080 在左，副屏 2560x1440 在右（工作区高度略小）
const left = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };
const two = [left, right];

// 单屏
ok('单屏直接返回该屏', pickAreaForBounds({ x: 10, y: 10, width: 200, height: 200 }, [left]) === left);
ok('单屏空数组返回 null', pickAreaForBounds({ x: 0, y: 0, width: 10, height: 10 }, []) === null);
ok('null 输入安全', pickAreaForBounds({ x: 0, y: 0, width: 10, height: 10 }, null) === null);

// 窗口在左屏 -> 选左屏
ok('窗口在左屏 -> 左屏', pickAreaForBounds({ x: 100, y: 100, width: 300, height: 300 }, two) === left);
// 窗口在右屏 -> 选右屏（这是修复的关键：不再被拉回主屏）
ok('窗口在右屏 -> 右屏', pickAreaForBounds({ x: 2200, y: 400, width: 300, height: 300 }, two) === right);
ok('窗口完全在右屏远端 -> 右屏', pickAreaForBounds({ x: 4400, y: 1300, width: 80, height: 80 }, two) === right);

// 中心在边界附近：窗口横跨两屏，中心落在右屏 -> 右屏
ok('横跨两屏且中心偏右 -> 右屏', pickAreaForBounds({ x: 1800, y: 200, width: 400, height: 300 }, two) === right);
ok('横跨两屏且中心偏左 -> 左屏', pickAreaForBounds({ x: 1700, y: 200, width: 300, height: 300 }, two) === left);

// 完全在屏幕外（例如 y 远超所有屏）-> 用最近的兜底
ok('屏幕外仍返回某屏(不崩)', !!pickAreaForBounds({ x: -5000, y: -5000, width: 100, height: 100 }, two));
ok('屏幕外取最近(左侧)', pickAreaForBounds({ x: -5000, y: 0, width: 100, height: 100 }, two) === left);
ok('屏幕外取最近(右侧)', pickAreaForBounds({ x: 9000, y: 0, width: 100, height: 100 }, two) === right);

// 上下排列的三屏
const top = { x: 1920, y: -1200, width: 1920, height: 1170 };
const three = [left, right, top];
ok('三屏：上方屏可被选中', pickAreaForBounds({ x: 2000, y: -1000, width: 200, height: 200 }, three) === top);
ok('三屏：左屏仍可选', pickAreaForBounds({ x: 50, y: 50, width: 200, height: 200 }, three) === left);

// 负坐标显示器（主屏在右侧的场景）
const negLeft = { x: -1920, y: 0, width: 1920, height: 1040 };
const mainRight = { x: 0, y: 0, width: 2560, height: 1400 };
ok('负坐标屏可被选中', pickAreaForBounds({ x: -1500, y: 100, width: 200, height: 200 }, [mainRight, negLeft]) === negLeft);

// rectContains
ok('rectContains 内部点', rectContains(left, 100, 100) === true);
ok('rectContains 右边界外', rectContains(left, 1920, 100) === false);
ok('rectContains 上边界内', rectContains(left, 0, 0) === true);

// areaChanged
ok('areaChanged: 相同为 false', areaChanged(left, { ...left }) === false);
ok('areaChanged: 尺寸变为 true', areaChanged(left, { ...left, width: 100 }) === true);
ok('areaChanged: null 为 true', areaChanged(null, left) === true);
ok('areaChanged: 两者为 null 为 true', areaChanged(null, null) === true);