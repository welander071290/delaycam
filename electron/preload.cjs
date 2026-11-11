const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('delayCam', {
  close: () => ipcRenderer.send('close-window'),
})