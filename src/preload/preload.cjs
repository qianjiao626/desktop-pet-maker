// preload: 必须用 CommonJS（Electron 沙箱 preload 不支持 ESM）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMode: () => ipcRenderer.invoke('mode:get'),

  // 制作器
  openImage: () => ipcRenderer.invoke('image:open'),
  openImages: () => ipcRenderer.invoke('image:openMany'),
  savePack: (pack, images, suggestedName) =>
    ipcRenderer.invoke('pack:save', { pack, images, suggestedName }),
  openPack: () => ipcRenderer.invoke('pack:open'),
  exportFolder: (pack, images) => ipcRenderer.invoke('pack:exportFolder', { pack, images }),
  launchPreview: (pack, images) => ipcRenderer.invoke('pet:launch', { pack, images }),
  launchPetPath: (p) => ipcRenderer.invoke('pet:launchPath', p),

  // 运行时
  getPetPack: () => ipcRenderer.invoke('pet:getPack'),
  setPos: (x, y) => ipcRenderer.send('pet:setPos', { x, y }),
  setSize: (w, h) => ipcRenderer.send('pet:setSize', { w, h }),
  getBounds: () => ipcRenderer.invoke('pet:getBounds'),
  workArea: () => ipcRenderer.invoke('screen:workArea'),
  allWorkAreas: () => ipcRenderer.invoke('screen:allWorkAreas'),
  savePos: (id, x, y) => ipcRenderer.send('pet:savePos', { id, x, y }),
  setIgnoreMouse: (flag) => ipcRenderer.send('pet:setIgnoreMouse', flag),
  setAlwaysOnTop: (flag) => ipcRenderer.send('pet:setAlwaysOnTop', flag),
  closePet: () => ipcRenderer.send('pet:close'),
  loadImageFile: (p) => ipcRenderer.invoke('pet:loadImageFile', p),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  revealFile: (p) => ipcRenderer.invoke('app:revealFile', p),
  appVersion: () => ipcRenderer.invoke('app:version'),
  listInstalled: () => ipcRenderer.invoke('pet:listInstalled'),
  installPack: (srcPath) => ipcRenderer.invoke('pet:install', srcPath),
  runInstalled: (id) => ipcRenderer.invoke('pet:runInstalled', id),
  uninstall: (id) => ipcRenderer.invoke('pet:uninstall', id),
  libraryGet: () => ipcRenderer.invoke('library:get'),
  libraryToggleFav: (id) => ipcRenderer.invoke('library:toggleFav', id),
  libraryTouch: (id) => ipcRenderer.invoke('library:touch', id),

  // AI 抠图
  listModels: () => ipcRenderer.invoke('ai:listModels'),
  downloadModel: (id) => ipcRenderer.invoke('ai:downloadModel', id),
  deleteModel: (id) => ipcRenderer.invoke('ai:deleteModel', id),
  segment: (modelId, dataUrl, threshold, feather) => ipcRenderer.invoke('ai:segment', { modelId, dataUrl, threshold, feather }),
  onDownloadProgress: (cb) => ipcRenderer.on('ai:downloadProgress', (e, p) => cb(p)),


  // ---- 快速模式：上传一张图 -> 启用/停用 ----
  quickEnable: (pack, frames) => ipcRenderer.invoke('quick:enable', { pack, frames }),
  quickDisable: () => ipcRenderer.invoke('quick:disable'),
  quickIsEnabled: () => ipcRenderer.invoke('quick:isEnabled'),
  quickSetWalk: (walking) => ipcRenderer.invoke('quick:setWalk', walking),
  quickSetBugChase: (on) => ipcRenderer.invoke('quick:setBugChase', !!on),
  quickPat: () => ipcRenderer.invoke('quick:pat'),
  onQuickState: (cb) => ipcRenderer.on('quick:state', (e, v) => cb(v)),

  // 宠物侧接收指令
  onQuickWalk: (cb) => ipcRenderer.on('quick:walk', (e, v) => cb(v)),
  onQuickBugChase: (cb) => ipcRenderer.on('quick:bugchase', (e, v) => cb(v)),
  setScale: (v) => ipcRenderer.send('pet:setScale', v),
  onQuickScale: (cb) => ipcRenderer.on('quick:scale', (e, v) => cb(v)),
  onQuickPat: (cb) => ipcRenderer.on('quick:pat', () => cb()),
  quickHit: (fromDir) => ipcRenderer.invoke('quick:hit', fromDir),
  quickSay: (text) => ipcRenderer.invoke('quick:say', text),
  onQuickHit: (cb) => ipcRenderer.on('quick:hit', (e, d) => cb(d)),
  onQuickSay: (cb) => ipcRenderer.on('quick:say', (e, t) => cb(t)),

  onQuickReload: (cb) => ipcRenderer.on('quick:reload', () => cb()),

  onWorkArea: (cb) => ipcRenderer.on('screen:displayChanged', (e, wa) => cb(wa)),
});