const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.INSIGHT_PORT || "3000";
const APP_URL = process.env.INSIGHT_URL || `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, "..");

function ensureScreenpipe() {
  const node = process.env.npm_node_execpath || "node";
  spawn(node, [path.join(ROOT, "scripts", "ensure-screenpipe.cjs")], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
    env: process.env,
  }).unref();
}

async function waitForServer(url) {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Insight server did not start at ${url}`);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Insight",
    backgroundColor: "#f6f3ec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadURL(APP_URL);
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  process.env.INSIGHT_DESKTOP = "1";
  ensureScreenpipe();
  await waitForServer(APP_URL);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
