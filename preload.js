const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("gnva", {
  chooseCsv: () => ipcRenderer.invoke("dialog:csv"),
  chooseDesign: () => ipcRenderer.invoke("dialog:design"),
  chooseOutput: () => ipcRenderer.invoke("dialog:output"),
  inspectCsv: (filePath) => ipcRenderer.invoke("csv:inspect", filePath),
  previewQr: (url) => ipcRenderer.invoke("qr:preview", url),
  inspectDesign: (filePath) => ipcRenderer.invoke("design:inspect", filePath),
  startJob: (config) => ipcRenderer.invoke("job:start", config),
  cancelJob: (jobId) => ipcRenderer.invoke("job:cancel", jobId),
  openFolder: (directory) => ipcRenderer.invoke("folder:open", directory),
  onProgress: (callback) => listen("job:progress", callback),
  onOutput: (callback) => listen("job:output", callback),
  onComplete: (callback) => listen("job:complete", callback),
});
