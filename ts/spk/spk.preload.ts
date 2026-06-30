import { ipcRenderer } from "electron"

export const spkIpc:any = {
  fetch: (config:any) => ipcRenderer.invoke('spk-fetch', config),
  getTranslateCache: (payload:any) => ipcRenderer.invoke('spk-get-translate-cache', payload),
  setTranslateCache: (payload:any) => ipcRenderer.invoke('spk-set-translate-cache', payload),
  getConfig: (payload:any) => ipcRenderer.invoke('spk-get-config', payload),
}
window.spkIpc = spkIpc