const { app, BrowserWindow, shell } = require('electron');

const SITE = 'https://faceitsk.vercel.app/';

function createWindow() {
  const win = new BrowserWindow({
    width: 430,
    height: 900,
    title: 'StandKnife',
    backgroundColor: '#0d1220',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  win.loadURL(SITE);

  // Ссылки на сторонние сайты открываем в обычном браузере, а не внутри окна
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(SITE)) { e.preventDefault(); shell.openExternal(url); }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
