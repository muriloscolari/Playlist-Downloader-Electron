const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    addToQueue: (url) => ipcRenderer.invoke('add-to-queue', url),
    startQueue: () => ipcRenderer.invoke('start-queue'),
    openDownloads: () => ipcRenderer.invoke('open-downloads-folder'),
    chooseFolder: () => ipcRenderer.invoke('choose-folder'),
    getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),

    // Events
    onLog: (callback) => ipcRenderer.on('log-message', (event, msg) => callback(msg)),
    onProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
    onQueueUpdate: (callback) => ipcRenderer.on('queue-update', (event, data) => callback(data)),
    onStatusChange: (callback) => ipcRenderer.on('status-change', (event, status) => callback(status)),
    onFinished: (callback) => ipcRenderer.on('download-finished', (event, msg) => callback(msg)),
    onError: (callback) => ipcRenderer.on('download-error', (event, err) => callback(err))
});
