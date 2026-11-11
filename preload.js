/* Ponte mínima entre o Prosa (site) e o programa do Windows. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prosaDesktop', {
  version: '1.0.0',
  openExternal: url => ipcRenderer.invoke('open-external', url),
  onAuthUrl: cb => ipcRenderer.on('auth-url', (_e, url) => cb(url)),
  onPickScreen: cb => ipcRenderer.on('pick-screen', (_e, sources) => cb(sources)),
  pickResult: id => ipcRenderer.send('pick-result', id),
});
