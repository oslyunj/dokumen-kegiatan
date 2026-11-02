const { contextBridge, ipcRenderer } = require('electron');
const call = async (ch, ...a) => { const r = await ipcRenderer.invoke(ch, ...a); if (r && r.ok) return r.v; throw (r && r.error) || { code: 'error', message: 'Gagal' }; };
contextBridge.exposeInMainWorld('desktop', {
  call,
  onChanges: fn => { const h = (_e, c) => fn(c); ipcRenderer.on('db:changes', h); return () => ipcRenderer.removeListener('db:changes', h); },
});
