const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("insightDesktop", {
  isDesktop: true,
  platform: process.platform,
});
