const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const { connect } = require("node:net");
const { existsSync } = require("node:fs");
const path = require("node:path");

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 7800);
const BACKEND = path.join(__dirname, "vendor", "server.mjs");

let backendProcess = null;
let mainWindow = null;

function resolveNodeRuntimeBin() {
  const localNodeDir = path.join(__dirname, "vendor", "node-runtime");
  const resourceNodeDir = path.join(process.resourcesPath, "node-runtime");
  const nodeDir = existsSync(localNodeDir) ? localNodeDir : resourceNodeDir;
  return process.platform === "win32"
    ? path.join(nodeDir, "node.exe")
    : path.join(nodeDir, "bin", "node");
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    if (await isPortOpen(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureBackend() {
  if (await isPortOpen(PANEL_PORT)) {
    return;
  }
  const localRelayBin = path.join(__dirname, "vendor", "relay-server", "dist", "cli.js");
  const resourceRelayBin = path.join(process.resourcesPath, "relay-server", "dist", "cli.js");
  const nodeBin = resolveNodeRuntimeBin();
  backendProcess = spawn(nodeBin, [BACKEND], {
    env: {
      ...process.env,
      NODE_BIN: nodeBin,
      PANEL_PORT: String(PANEL_PORT),
      RELAY_BIN: existsSync(localRelayBin) ? localRelayBin : resourceRelayBin,
    },
    stdio: "ignore",
  });
  backendProcess.on("exit", () => {
    backendProcess = null;
  });
  await waitForPort(PANEL_PORT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 880,
    minWidth: 380,
    minHeight: 640,
    title: "Codex Relay 控制面板",
    backgroundColor: "#0e1014",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PANEL_PORT}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await ensureBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
