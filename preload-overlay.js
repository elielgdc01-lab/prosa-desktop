const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('prosaOverlay', {
  onState: cb => ipcRenderer.on('overlay-state', (_e, st) => cb(st)),
});
