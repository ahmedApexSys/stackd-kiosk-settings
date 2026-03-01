/**
 * STACKD Kiosk Settings — Preload Script
 * Exposes safe IPC channels to renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  // Settings file I/O
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  exportSettings: (settings) => ipcRenderer.invoke('export-settings', settings),
  importSettings: () => ipcRenderer.invoke('select-file'),

  // API proxy (avoids CORS issues)
  apiGet: (url, apiKey) => ipcRenderer.invoke('api-get', { url, apiKey }),
  apiPost: (url, apiKey, body) => ipcRenderer.invoke('api-post', { url, apiKey, body }),

  // Printer operations
  checkPrinter: (ip, port) => ipcRenderer.invoke('check-printer', { ip, port }),
  printTest: (ip, port) => ipcRenderer.invoke('print-test', { ip, port }),
});
