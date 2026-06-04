import { ipcRenderer } from "electron"

export const uniIpc:any = {
  fetch: (config:any) => ipcRenderer.invoke('uni-fetch', config),
  getTranslateCache: (payload:any) => ipcRenderer.invoke('uni-get-translate-cache', payload),
  setTranslateCache: (payload:any) => ipcRenderer.invoke('uni-set-translate-cache', payload),
  getConfig: (payload:any) => ipcRenderer.invoke('uni-get-config', payload),
}
window.uniIpc = uniIpc