"use strict";
const electron = require("electron");
const path = require("path");
const os = require("os");
const pty = require("node-pty");
const crypto = require("crypto");
const promises = require("fs/promises");
const child_process = require("child_process");
const fs = require("fs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
class PtyManager {
  sessions = /* @__PURE__ */ new Map();
  dataListeners = /* @__PURE__ */ new Set();
  exitListeners = /* @__PURE__ */ new Set();
  /**
   * Spawn `claude` CLI numa pasta. Retorna ID da sessão.
   */
  spawn(opts) {
    const { cwd, cols = 120, rows = 30 } = opts;
    const id = crypto.randomUUID();
    const isWin = process.platform === "win32";
    let ptyProcess;
    try {
      const shellPath = isWin ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/bash";
      const shellArgs = isWin ? ["/C", "claude"] : ["-c", "claude"];
      ptyProcess = pty__namespace.spawn(shellPath, shellArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor"
        }
      });
    } catch (err) {
      return { error: `Failed to spawn claude: ${err.message}` };
    }
    const session = {
      pty: ptyProcess,
      cwd,
      startedAt: Date.now()
    };
    this.sessions.set(id, session);
    ptyProcess.onData((data) => {
      for (const cb of this.dataListeners) cb(id, data);
    });
    ptyProcess.onExit(({ exitCode }) => {
      for (const cb of this.exitListeners) cb(id, exitCode || 0);
      this.sessions.delete(id);
    });
    return { ptyId: id };
  }
  write(ptyId, data) {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    session.pty.write(data);
    return true;
  }
  resize(ptyId, cols, rows) {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }
  kill(ptyId) {
    const session = this.sessions.get(ptyId);
    if (!session) return false;
    try {
      session.pty.kill();
    } catch {
    }
    this.sessions.delete(ptyId);
    return true;
  }
  killAll() {
    for (const [, session] of this.sessions) {
      try {
        session.pty.kill();
      } catch {
      }
    }
    this.sessions.clear();
  }
  list() {
    return Array.from(this.sessions.entries()).map(([ptyId, s]) => ({
      ptyId,
      cwd: s.cwd,
      startedAt: s.startedAt
    }));
  }
  onData(cb) {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }
  onExit(cb) {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}
const ptyManager = new PtyManager();
function registerClaudeIPC() {
  electron.ipcMain.handle("claude:spawn", (_, opts) => {
    return ptyManager.spawn(opts);
  });
  electron.ipcMain.handle("claude:write", (_, ptyId, data) => {
    return ptyManager.write(ptyId, data);
  });
  electron.ipcMain.handle("claude:resize", (_, ptyId, cols, rows) => {
    return ptyManager.resize(ptyId, cols, rows);
  });
  electron.ipcMain.handle("claude:kill", (_, ptyId) => {
    return ptyManager.kill(ptyId);
  });
  electron.ipcMain.handle("claude:list", () => {
    return ptyManager.list();
  });
  ptyManager.onData((ptyId, data) => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("claude:data", ptyId, data);
      }
    }
  });
  ptyManager.onExit((ptyId, code) => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("claude:exit", ptyId, code);
      }
    }
  });
}
const HIDDEN_ALLOWLIST = /* @__PURE__ */ new Set([".vscode", ".github", ".claude"]);
async function listDir(dirPath) {
  try {
    const entries = await promises.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => {
      if (e.name.startsWith(".")) return HIDDEN_ALLOWLIST.has(e.name);
      if (e.name === "node_modules") return false;
      return true;
    }).map((e) => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      type: e.isDirectory() ? "dir" : "file"
    })).sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error("listDir error:", dirPath, err);
    return [];
  }
}
function registerFsIPC() {
  electron.ipcMain.handle("fs:listDir", (_, dirPath) => listDir(dirPath));
  electron.ipcMain.handle("fs:readFile", async (_, filePath) => {
    try {
      const content = await promises.readFile(filePath, "utf-8");
      return { content };
    } catch (err) {
      return { error: err.message };
    }
  });
  electron.ipcMain.handle("fs:writeFile", async (_, filePath, content) => {
    try {
      await promises.writeFile(filePath, content, "utf-8");
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });
  electron.ipcMain.handle("fs:stat", async (_, p) => {
    try {
      const s = await promises.stat(p);
      return {
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        size: s.size,
        mtime: s.mtimeMs
      };
    } catch (err) {
      return { error: err.message };
    }
  });
  electron.ipcMain.handle("dialog:openWorkspace", async () => {
    const win = electron.BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true };
    const result = await electron.dialog.showOpenDialog(win, {
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });
}
function resolveClaudeCommand() {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const cliJs = path.join(
        appdata,
        "npm",
        "node_modules",
        "@anthropic-ai",
        "claude-code",
        "cli.js"
      );
      if (fs.existsSync(cliJs)) {
        return { command: "node", prefixArgs: [cliJs] };
      }
    }
    return { command: "claude.cmd", prefixArgs: [] };
  }
  return { command: "claude", prefixArgs: [] };
}
class AgentManager {
  turns = /* @__PURE__ */ new Map();
  eventListeners = /* @__PURE__ */ new Set();
  sessionToTurn = /* @__PURE__ */ new Map();
  // sessionId -> turnId
  startedSessions = /* @__PURE__ */ new Set();
  // sessions que já tiveram pelo menos 1 turn
  /**
   * Cria uma session ID nova (UUID v4). Não spawna processo ainda — só registra.
   */
  createSession() {
    return crypto.randomUUID();
  }
  /**
   * Manda um prompt do user e stream eventos.
   * Reutiliza session se existir; senão Claude cria ao receber o session-id.
   */
  sendPrompt(opts) {
    const { sessionId, cwd, prompt } = opts;
    if (this.sessionToTurn.has(sessionId)) {
      return { error: "Já tem um turn rodando nessa sessão. Aguarda ou cancela." };
    }
    const turnId = crypto.randomUUID();
    const resolved = resolveClaudeCommand();
    const isFirstTurn = !this.startedSessions.has(sessionId);
    const sessionFlags = isFirstTurn ? ["--session-id", sessionId] : ["--resume", sessionId];
    const args = [
      ...resolved.prefixArgs,
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...sessionFlags
    ];
    let proc;
    try {
      proc = child_process.spawn(resolved.command, args, {
        cwd,
        env: process.env,
        windowsHide: true,
        // shell=true só se cair no fallback claude.cmd (sem cli.js detectado)
        shell: resolved.command.endsWith(".cmd")
      });
    } catch (err) {
      return { error: `Falha ao spawnar claude: ${err.message}` };
    }
    const turn = {
      sessionId,
      proc,
      buffer: ""
    };
    this.turns.set(turnId, turn);
    this.sessionToTurn.set(sessionId, turnId);
    this.startedSessions.add(sessionId);
    this.emit(sessionId, { type: "turn_start", sessionId });
    proc.stdout?.on("data", (chunk) => {
      turn.buffer += chunk.toString("utf-8");
      this.processBuffer(turn, sessionId);
    });
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf-8").trim();
      if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed")) {
        this.emit(sessionId, { type: "error", message: text });
      }
    });
    proc.on("exit", (code) => {
      this.processBuffer(turn, sessionId);
      this.turns.delete(turnId);
      this.sessionToTurn.delete(sessionId);
      if (code !== 0 && code !== null) {
        this.emit(sessionId, { type: "error", message: `claude saiu com código ${code}` });
      }
    });
    proc.on("error", (err) => {
      this.emit(sessionId, { type: "error", message: `proc error: ${err.message}` });
      this.turns.delete(turnId);
      this.sessionToTurn.delete(sessionId);
    });
    return { turnId };
  }
  /**
   * Processa buffer linha-por-linha, parseia JSON e emite eventos.
   */
  processBuffer(turn, sessionId) {
    const lines = turn.buffer.split("\n");
    turn.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        this.handleClaudeMessage(obj, sessionId);
      } catch (err) {
      }
    }
  }
  /**
   * Mapeia mensagem do Claude CLI pra evento AgentEvent simples.
   */
  handleClaudeMessage(msg, sessionId) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "system" && msg.subtype === "init") {
      this.emit(sessionId, {
        type: "session_init",
        sessionId: msg.session_id || sessionId,
        model: msg.model,
        tools: msg.tools || [],
        cwd: msg.cwd
      });
      return;
    }
    if (msg.type === "system" && msg.subtype === "status") {
      this.emit(sessionId, { type: "status", status: msg.status });
      return;
    }
    if (msg.type === "stream_event" && msg.event) {
      const ev = msg.event;
      if (ev.type === "content_block_start") {
        const block = ev.content_block;
        if (block?.type === "tool_use") {
          this.emit(sessionId, {
            type: "tool_use_start",
            toolUseId: block.id,
            name: block.name,
            index: ev.index
          });
        }
        return;
      }
      if (ev.type === "content_block_delta") {
        const delta = ev.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          this.emit(sessionId, { type: "text_delta", text: delta.text });
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          this.emit(sessionId, { type: "thinking_delta", text: delta.thinking });
        } else if (delta?.type === "input_json_delta") {
          this.emit(sessionId, {
            type: "tool_use_input_delta",
            toolUseId: "",
            partial: delta.partial_json || ""
          });
        }
        return;
      }
      if (ev.type === "message_stop") {
        return;
      }
      return;
    }
    if (msg.type === "assistant" && msg.message?.content) {
      const blocks = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of blocks) {
        if (block.type === "tool_use") {
          this.emit(sessionId, {
            type: "tool_use_end",
            toolUseId: block.id,
            name: block.name,
            input: block.input || {}
          });
        }
      }
      return;
    }
    if (msg.type === "user" && msg.message?.content) {
      const blocks = Array.isArray(msg.message.content) ? msg.message.content : [];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          const content = Array.isArray(block.content) ? block.content.map((c) => c.text || JSON.stringify(c)).join("") : typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          this.emit(sessionId, {
            type: "tool_result",
            toolUseId: block.tool_use_id,
            result: content,
            isError: !!block.is_error
          });
        }
      }
      return;
    }
    if (msg.type === "result") {
      this.emit(sessionId, {
        type: "turn_complete",
        sessionId: msg.session_id || sessionId,
        costUsd: msg.total_cost_usd,
        usage: msg.usage ? {
          inputTokens: msg.usage.input_tokens || 0,
          outputTokens: msg.usage.output_tokens || 0,
          cacheReadInputTokens: msg.usage.cache_read_input_tokens || 0,
          cacheCreationInputTokens: msg.usage.cache_creation_input_tokens || 0
        } : void 0,
        stopReason: msg.stop_reason
      });
      return;
    }
  }
  cancel(sessionId) {
    const turnId = this.sessionToTurn.get(sessionId);
    if (!turnId) return false;
    const turn = this.turns.get(turnId);
    if (!turn) return false;
    try {
      turn.proc.kill("SIGTERM");
    } catch {
    }
    this.turns.delete(turnId);
    this.sessionToTurn.delete(sessionId);
    return true;
  }
  cancelAll() {
    for (const [, turn] of this.turns) {
      try {
        turn.proc.kill("SIGTERM");
      } catch {
      }
    }
    this.turns.clear();
    this.sessionToTurn.clear();
  }
  onEvent(cb) {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }
  emit(sessionId, event) {
    for (const cb of this.eventListeners) cb(sessionId, event);
  }
}
const agentManager = new AgentManager();
function registerAgentIPC() {
  electron.ipcMain.handle("agent:createSession", () => {
    return { sessionId: agentManager.createSession() };
  });
  electron.ipcMain.handle("agent:send", (_, opts) => {
    return agentManager.sendPrompt(opts);
  });
  electron.ipcMain.handle("agent:cancel", (_, sessionId) => {
    return agentManager.cancel(sessionId);
  });
  agentManager.onEvent((sessionId, event) => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("agent:event", sessionId, event);
      }
    }
  });
}
let mainWindow = null;
function createMainWindow() {
  console.log("[main] createMainWindow start");
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    title: "UnderCode",
    backgroundColor: "#1f1f1f",
    // Antigravity exact (themeBackground)
    // Frame nativo escondido. Nossos próprios botões min/max/close no topbar.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  console.log("[main] BrowserWindow created");
  mainWindow.on("ready-to-show", () => {
    console.log("[main] ready-to-show fired");
    mainWindow?.show();
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomFactor(1.1);
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" || input.control && input.shift && input.key.toUpperCase() === "I") {
      event.preventDefault();
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow?.webContents.openDevTools({ mode: "detach" });
      }
      return;
    }
    if (input.key === "F11") {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    if (!input.control || input.alt) return;
    const key = input.key.toUpperCase();
    if (key === "R") {
      event.preventDefault();
      if (input.shift) mainWindow?.webContents.reloadIgnoringCache();
      else mainWindow?.webContents.reload();
      return;
    }
    if (input.key === "=" || input.key === "+") {
      event.preventDefault();
      const cur = mainWindow.webContents.getZoomFactor();
      mainWindow.webContents.setZoomFactor(Math.min(cur + 0.1, 3));
    } else if (input.key === "-") {
      event.preventDefault();
      const cur = mainWindow.webContents.getZoomFactor();
      mainWindow.webContents.setZoomFactor(Math.max(cur - 0.1, 0.5));
    } else if (input.key === "0") {
      event.preventDefault();
      mainWindow.webContents.setZoomFactor(1);
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    console.log("[main] loadURL:", process.env.ELECTRON_RENDERER_URL);
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((err) => {
      console.error("[main] loadURL FAILED:", err);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  electron.Menu.setApplicationMenu(null);
  electron.ipcMain.handle("app:getCwd", () => os.homedir());
  electron.ipcMain.on("window:minimize", () => mainWindow?.minimize());
  electron.ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  electron.ipcMain.on("window:close", () => mainWindow?.close());
  electron.ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
  registerClaudeIPC();
  registerFsIPC();
  registerAgentIPC();
  createMainWindow();
  mainWindow?.on("maximize", () => mainWindow?.webContents.send("window:maximized", true));
  mainWindow?.on("unmaximize", () => mainWindow?.webContents.send("window:maximized", false));
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
electron.app.on("window-all-closed", () => {
  ptyManager.killAll();
  agentManager.cancelAll();
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  ptyManager.killAll();
  agentManager.cancelAll();
});
