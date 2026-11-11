/* Prosa para Windows.
   Abre o Prosa publicado numa janela própria; o login com Google acontece no navegador
   e volta para cá pelo endereço prosa://auth (o Google não deixa logar dentro de apps assim).
   Extras do programa: jogo em andamento ("Jogando…"), sobreposição na tela do jogo e atualização automática. */
const { app, BrowserWindow, session, shell, ipcMain, desktopCapturer, Menu, screen, nativeImage } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');
const GAMES = require('./games.js');

const SITE = 'https://vemprosa.vercel.app';
const TEST = process.env.PROSA_TEST === '1';   // usado só nos testes automáticos: janela escondida e nada abre no navegador
const ALLOWED = new Set(['media', 'notifications', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);
let win = null, overlay = null, pendingAuth = null;

app.setAppUserModelId('app.prosa.desktop');   // nome certo nos avisos do Windows
/* testes usam uma pasta só deles: nunca encostam no login de quem usa o programa */
if (TEST) app.setPath('userData', path.join(app.getPath('temp'), 'Prosa-teste'));

/* uma janela só: abrir de novo (ou o retorno do login) foca a que já existe */
if (!TEST && !app.requestSingleInstanceLock()) { app.quit(); }
else if (!TEST) {
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
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

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

  win.webContents.on('did-finish-load', () => {
    if (pendingAuth) { send('auth-url', pendingAuth); pendingAuth = null; }
    if (activity) send('activity', activity);
  });
  /* F5 ou Ctrl+R recarregam (pega a versão nova do site sem fechar) */
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { e.preventDefault(); win.webContents.reload(); }
  });
  /* links de fora abrem no navegador; dentro do Prosa, ficam aqui */
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(SITE)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('page-title-updated', e => e.preventDefault());
  win.on('focus', () => win.flashFrame(false));
  win.on('closed', () => { win = null; if (overlay && !overlay.isDestroyed()) overlay.destroy(); overlay = null; });
}

/* ---------- compartilhar tela: o Prosa mostra a lista e devolve a escolha ---------- */
let pickReply = null;
ipcMain.on('pick-result', (_e, id) => { if (pickReply) { pickReply(id); pickReply = null; } });
function askPick(sources){
  return new Promise(resolve => {
    pickReply = resolve;
    send('pick-screen', sources.map(s => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL() })));
  });
}

ipcMain.on('app-version', e => { e.returnValue = app.getVersion(); });
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  if (TEST) { console.log('[teste] abriria no navegador:', url.slice(0, 120)); return true; }
  shell.openExternal(url); return true;
});

/* ---------- jogo em andamento ----------
   A cada 15 s lê a lista de programas abertos (tasklist) e procura um jogo conhecido.
   A cada 60 s também olha as pastas da Steam, Epic, Riot e Xbox, para pegar jogos fora da lista. */
let activity = null, storeGame = null;
const STORE = /\\(?:steamapps\\common|Epic Games|Riot Games|XboxGames|Program Files\\(?:EA Games|Ubisoft))\\([^\\]+)\\/i;
const IGNORE = /^(steam|steamwebhelper|epicgameslauncher|riotclientservices|riotclientux|easteamsapp|eadesktop|upc|xboxpcapp|gamebar|crashreport|unitycrashhandler|crashpad)/i;
function setActivity(name){
  const next = name ? { name, since: activity?.name === name ? activity.since : Date.now() } : null;
  if ((next?.name || null) === (activity?.name || null)) return;
  activity = next; send('activity', activity); updateOverlay();
}
function scanTasks(){
  if (TEST && process.env.PROSA_FAKE_GAME) return setActivity(process.env.PROSA_FAKE_GAME);
  execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    if (err) return;
    const names = new Set(out.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]?.toLowerCase()).filter(Boolean));
    for (const exe of names) if (GAMES[exe]) return setActivity(GAMES[exe]);
    setActivity(storeGame && names.has(storeGame.exe) ? storeGame.name : null);
  });
}
function scanStores(){
  if (TEST) return;
  const ps = "Get-Process | Where-Object { $_.Path -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Path }";
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    if (err) return;
    storeGame = null;
    for (const p of out.split(/\r?\n/)) {
      const m = p.match(STORE), exe = p.split('\\').pop().toLowerCase();
      if (m && !IGNORE.test(exe)) { storeGame = { name: m[1].replace(/[_-]+/g, ' ').trim(), exe }; break; }
    }
    scanTasks();
  });
}

/* ---------- sobreposição na tela do jogo ----------
   Janela transparente, sempre por cima e que deixa o clique passar. Aparece só em chamada e com jogo aberto. */
let ovState = null;
function updateOverlay(){
  const show = !!(ovState?.enabled && ovState.people?.length && (activity || ovState.always));
  if (!show) { if (overlay && !overlay.isDestroyed()) { overlay.webContents.send('overlay-state', null); overlay.hide(); } return; }
  if (!overlay || overlay.isDestroyed()) {
    const wa = screen.getPrimaryDisplay().workArea;
    overlay = new BrowserWindow({
      x: wa.x + 8, y: wa.y + 80, width: 280, height: 420, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setIgnoreMouseEvents(true);
    overlay.setVisibleOnAllWorkspaces(true);
    overlay.loadFile(path.join(__dirname, 'overlay.html'));
    overlay.webContents.once('did-finish-load', () => { overlay.webContents.send('overlay-state', ovState); if (!TEST) overlay.showInactive(); });
    return;
  }
  overlay.webContents.send('overlay-state', ovState);
  if (!overlay.isVisible() && !TEST) overlay.showInactive();
}
ipcMain.on('overlay-state', (_e, st) => { ovState = st; updateOverlay(); });

/* ---------- bolinha na barra de tarefas e piscar ---------- */
ipcMain.on('badge', (_e, b) => {
  if (TEST) console.log('[teste] bolinha:', b?.count, b?.img ? 'com imagem' : 'sem imagem');
  if (!win || win.isDestroyed()) return;
  try {
    if (!b || !b.count || typeof b.img !== 'string' || !b.img.startsWith('data:image/png')) win.setOverlayIcon(null, '');
    else win.setOverlayIcon(nativeImage.createFromDataURL(b.img), `${b.count} ${b.count === 1 ? 'novidade' : 'novidades'} no Prosa`);
  } catch {}
});
ipcMain.on('flash', () => { if (TEST) console.log('[teste] piscar pedido'); if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); });

/* ---------- atualização automática do programa ---------- */
let updater = null;
function setupUpdates(){
  if (TEST || !app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-downloaded', info => send('app-update', { version: info.version }));
    updater.on('error', () => {});
    updater.checkForUpdates().catch(() => {});
    setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  } catch {}
}
ipcMain.on('app-update-install', () => { if (updater) updater.quitAndInstall(false, true); });

if (TEST) { app.commandLine.appendSwitch('mute-audio'); app.commandLine.appendSwitch('use-fake-device-for-media-stream'); }
app.whenReady().then(() => {
  const ses = session.defaultSession;
  const fromSite = wc => wc && wc.getURL().startsWith(SITE);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(fromSite(wc) && ALLOWED.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => !!wc && fromSite(wc) && ALLOWED.has(perm));
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      const visible = sources.filter(s => s.name && !/^Prosa/.test(s.name));
      const id = await askPick(visible);
      const chosen = visible.find(s => s.id === id);
      if (!chosen) return callback({});
      callback(chosen.id.startsWith('screen') ? { video: chosen, audio: 'loopback' } : { video: chosen });
    } catch { callback({}); }
  });
  createWindow();
  handleArgs(process.argv);
  scanStores(); setInterval(scanTasks, 15000); setInterval(scanStores, 60000);
  setupUpdates();
});
app.on('window-all-closed', () => app.quit());
