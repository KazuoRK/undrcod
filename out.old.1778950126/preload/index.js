"use strict";
const electron = require("electron");
const api = {
  agent: {
    createSession: () => electron.ipcRenderer.invoke("agent:createSession"),
    send: (opts) => electron.ipcRenderer.invoke("agent:send", opts),
    cancel: (sessionId) => electron.ipcRenderer.invoke("agent:cancel", sessionId),
    onEvent: (sessionId, cb) => {
      const handler = (_, id, event) => {
        if (id === sessionId) cb(event);
      };
      electron.ipcRenderer.on("agent:event", handler);
      return () => electron.ipcRenderer.removeListener("agent:event", handler);
    }
  },
  claude: {
    spawn: (opts) => electron.ipcRenderer.invoke("claude:spawn", opts),
    write: (ptyId, data) => electron.ipcRenderer.invoke("claude:write", ptyId, data),
    resize: (ptyId, cols, rows) => electron.ipcRenderer.invoke("claude:resize", ptyId, cols, rows),
    kill: (ptyId) => electron.ipcRenderer.invoke("claude:kill", ptyId),
    list: () => electron.ipcRenderer.invoke("claude:list"),
    onData: (ptyId, cb) => {
      const handler = (_, id, data) => {
        if (id === ptyId) cb(data);
      };
      electron.ipcRenderer.on("claude:data", handler);
      return () => electron.ipcRenderer.removeListener("claude:data", handler);
    },
    onExit: (ptyId, cb) => {
      const handler = (_, id, code) => {
        if (id === ptyId) cb(code);
      };
      electron.ipcRenderer.on("claude:exit", handler);
      return () => electron.ipcRenderer.removeListener("claude:exit", handler);
    }
  },
  fs: {
    listDir: (path) => electron.ipcRenderer.invoke("fs:listDir", path),
    readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path),
    writeFile: (path, content) => electron.ipcRenderer.invoke("fs:writeFile", path, content),
    stat: (path) => electron.ipcRenderer.invoke("fs:stat", path)
  },
  dialog: {
    openWorkspace: () => electron.ipcRenderer.invoke("dialog:openWorkspace")
  },
  /** Utility: home directory pra workspace default */
  getCwd: () => electron.ipcRenderer.invoke("app:getCwd"),
  /** Window controls (custom titlebar) */
  window: {
    minimize: () => electron.ipcRenderer.send("window:minimize"),
    maximize: () => electron.ipcRenderer.send("window:maximize"),
    close: () => electron.ipcRenderer.send("window:close"),
    isMaximized: () => electron.ipcRenderer.invoke("window:isMaximized"),
    onMaximizedChange: (cb) => {
      const handler = (_, maximized) => cb(maximized);
      electron.ipcRenderer.on("window:maximized", handler);
      return () => electron.ipcRenderer.removeListener("window:maximized", handler);
    }
  }
};
electron.contextBridge.exposeInMainWorld("akaiAPI", api);
