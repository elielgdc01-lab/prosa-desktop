/* Prosa para Windows.
   Abre o Prosa publicado numa janela própria; o login com Google acontece no navegador
   e volta para cá pelo endereço prosa://auth (o Google não deixa logar dentro de apps assim). */
const { app, BrowserWindow, session, shell, ipcMain, desktopCapturer, Menu } = require('electron');
const path = require('node:path');

const SITE = 'https://vemprosa.vercel.app';
const TEST = process.env.PROSA_TEST === '1';   // usado só nos testes automáticos: janela escondida e nada abre no navegador
const ALLOWED = new Set(['media', 'notifications', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);
let win = null, pendingAuth = null;

app.setAppUserModelId('app.prosa.desktop');   // nome certo nos avisos do Windows

/* uma janela só: abrir de novo (ou o retorno do login) foca a que já existe */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => { handleArgs(argv); focusWin(); });
}
if (!TEST) {
  if (process.defaultApp) app.setAsDefaultProtocolClient('prosa', process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient('prosa');
}

function handleArgs(argv){
  const url = argv.find(a => a.startsWith('prosa://'));
  if (!url) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('auth-url', url);
  else pendingAuth = url;
}
function focusWin(){ if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function createWindow(){
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 940, minHeight: 600,
    title: 'Prosa', backgroundColor: '#13100e', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  if (!TEST) win.once('ready-to-show', () => win.show());
  win.loadURL(SITE + '/?app=windows');

  win.webContents.on('did-finish-load', () => { if (pendingAuth) { win.webContents.send('auth-url', pendingAuth); pendingAuth = null; } });
  /* links de fora abrem no navegador; dentro do Prosa, ficam aqui */
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(SITE)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('page-title-updated', e => e.preventDefault());
  win.on('closed', () => { win = null; });
}

/* compartilhar tela: o Prosa mostra a lista e devolve a escolha */
let pickReply = null;
ipcMain.on('pick-result', (_e, id) => { if (pickReply) { pickReply(id); pickReply = null; } });
function askPick(sources){
  return new Promise(resolve => {
    pickReply = resolve;
    win.webContents.send('pick-screen', sources.map(s => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL() })));
  });
}

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  if (TEST) { console.log('[teste] abriria no navegador:', url.slice(0, 120)); return true; }
  shell.openExternal(url); return true;
});

if (TEST) { app.commandLine.appendSwitch('mute-audio'); app.commandLine.appendSwitch('use-fake-device-for-media-stream'); }
app.whenReady().then(() => {
  const ses = session.defaultSession;
  const fromSite = wc => wc && wc.getURL().startsWith(SITE);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(fromSite(wc) && ALLOWED.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => !!wc && fromSite(wc) && ALLOWED.has(perm));
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      const visible = sources.filter(s => s.name && !/^Prosa$/.test(s.name));
      const id = await askPick(visible);
      const chosen = visible.find(s => s.id === id);
      if (!chosen) return callback({});
      callback(chosen.id.startsWith('screen') ? { video: chosen, audio: 'loopback' } : { video: chosen });
    } catch { callback({}); }
  });
  createWindow();
  handleArgs(process.argv);
});
app.on('window-all-closed', () => app.quit());
