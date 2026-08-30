import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('servidorJanela', {
  minimizar: () => ipcRenderer.send('janela:minimizar'),
  fechar: () => ipcRenderer.send('janela:fechar'),
  encerrar: () => ipcRenderer.send('janela:encerrar')
})