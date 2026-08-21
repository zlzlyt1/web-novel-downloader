// preload：通过 contextBridge 向渲染进程暴露安全 API。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 应用
  getDefaultOutDir: () => ipcRenderer.invoke('app:getDefaultOutDir'),
  setTheme: (theme) => ipcRenderer.invoke('app:setTheme', theme),
  setReaderTheme: (theme) => ipcRenderer.invoke('app:setReaderTheme', theme),

  // 设置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  testContentApi: (payload) => ipcRenderer.invoke('config:testContentApi', payload),

  // 抓取
  getBook: (url) => ipcRenderer.invoke('crawl:getBook', url),
  searchBooks: (query) => ipcRenderer.invoke('search:books', query),
  startCrawl: (url, outDir, startChapter, endChapter) => ipcRenderer.invoke('crawl:start', { url, outDir, startChapter, endChapter }),
  cancelCrawl: () => ipcRenderer.send('crawl:cancel'),
  onProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('crawl:progress', listener);
    return () => ipcRenderer.removeListener('crawl:progress', listener);
  },

  // 文件
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  chooseFile: () => ipcRenderer.invoke('dialog:chooseFile'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  readText: (p) => ipcRenderer.invoke('file:readText', p),
  listTxts: (dir) => ipcRenderer.invoke('file:listTxts', dir),

  // 阅读器
  openReader: (filePath) => ipcRenderer.invoke('reader:open', filePath),
  getReaderFile: () => ipcRenderer.invoke('reader:getFile'),
  setReaderFile: (p) => ipcRenderer.invoke('reader:setFile', p),
});
