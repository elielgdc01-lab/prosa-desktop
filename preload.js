/* Ponte mínima entre o Prosa (site) e o programa do Windows. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('prosaDesktop', {
  version: ipcRenderer.sendSync('app-version'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  onAuthUrl: cb => ipcRenderer.on('auth-url', (_e, url) => cb(url)),
  onPickScreen: cb => ipcRenderer.on('pick-screen', (_e, sources) => cb(sources)),
  pickResult: id => ipcRenderer.send('pick-result', id),
  onActivity: cb => ipcRenderer.on('activity', (_e, a) => cb(a)),
  overlay: st => ipcRenderer.send('overlay-state', st),
  onAppUpdate: cb => ipcRenderer.on('app-update', (_e, info) => cb(info)),
  installAppUpdate: () => ipcRenderer.send('app-update-install'),
});
