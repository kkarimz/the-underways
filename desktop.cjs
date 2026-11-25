const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");

function openWindow() {
  const window = new BrowserWindow({
    width: 1160,
    height: 940,
    minWidth: 550,
    minHeight: 620,
    backgroundColor: "#131516",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.loadFile(join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
