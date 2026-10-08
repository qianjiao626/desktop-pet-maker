import { app, BrowserWindow, screen } from 'electron';

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  console.log('scaleFactor=' + d.scaleFactor);
  console.log('workArea=' + JSON.stringify(d.workArea));

  const t = new BrowserWindow({ width: 300, height: 200, show: false, frame: false, transparent: true, useContentSize: true });
  await t.loadURL('data:text/html,<body style=margin:0;background:red>hi</body>');
  await new Promise((r) => setTimeout(r, 900));
  console.log('A) 300x200 useContentSize -> getBounds=' + JSON.stringify(t.getBounds()) + ' contentBounds=' + JSON.stringify(t.getContentBounds()));
  const cap = await t.webContents.capturePage();
  console.log('   capturePage=' + JSON.stringify(cap.getSize()));

  const t2 = new BrowserWindow({ width: 300, height: 200, show: false, frame: false, transparent: true });
  await t2.loadURL('data:text/html,<body style=margin:0;background:blue>hi</body>');
  await new Promise((r) => setTimeout(r, 900));
  console.log('B) 300x200 默认 -> getBounds=' + JSON.stringify(t2.getBounds()) + ' contentBounds=' + JSON.stringify(t2.getContentBounds()));
  t2.setBounds({ x: 10, y: 20, width: 640, height: 480 });
  await new Promise((r) => setTimeout(r, 400));
  console.log('C) setBounds 640x480 后 -> getBounds=' + JSON.stringify(t2.getBounds()) + ' contentBounds=' + JSON.stringify(t2.getContentBounds()));

  app.quit();
}).catch((e) => { console.error('FATAL ' + e.message); app.quit(); });
