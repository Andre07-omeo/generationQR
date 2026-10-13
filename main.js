const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { inspectCsvFile } = require("./src/csv");
const { startStickerJob } = require("./src/batch");
const { createQrBuffer, getQrMinimumSize } = require("./src/render");

const activeJobs = new Map();
let mainWindow;
let importedDesignSnapshot;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: "#f5f5f2",
    title: "GNVA Sticker Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const job of activeJobs.values()) job.abortController.abort();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (importedDesignSnapshot) void fs.rm(importedDesignSnapshot, { force: true }).catch(() => {});
});

ipcMain.handle("dialog:csv", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Fichier CSV GNVA", extensions: ["csv"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:design", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Design d’autocollant",
        extensions: ["png", "jpg", "jpeg", "webp", "tif", "tiff", "svg", "pdf"],
      },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:output", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("csv:inspect", async (_event, filePath) => {
  if (typeof filePath !== "string") throw new Error("Fichier CSV invalide.");
  return inspectCsvFile(filePath, 5);
});

ipcMain.handle("qr:preview", async (_event, url) => {
  if (typeof url !== "string" || url.length > 4096) throw new Error("URL du QR invalide ou trop longue.");
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("L’URL du QR doit commencer par http:// ou https://.");
  }
  const buffer = await createQrBuffer(url, 512, { allowBelowMinimum: true });
  return {
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    minimumSize: getQrMinimumSize(url),
  };
});

ipcMain.handle("design:inspect", async (_event, filePath) => {
  if (typeof filePath !== "string") throw new Error("Fichier design invalide.");
  const ext = path.extname(filePath).toLowerCase();
  let imageBuffer;
  if (ext === ".pdf") {
    const { pdfToPng } = require("pdf-to-png-converter");
    const pages = await pdfToPng(filePath, {
      viewportScale: 300 / 72,
      disableFontFace: false,
      useSystemFonts: true,
    });
    if (!pages?.length) throw new Error("Aucune page lisible dans ce PDF.");
    imageBuffer = pages[0].content;
  } else {
    imageBuffer = await fs.readFile(filePath);
  }

  const sourceMetadata = await sharp(imageBuffer, { limitInputPixels: 180_000_000 }).metadata();
  const dpi = ext === ".pdf" ? 300 : Number(sourceMetadata.density) || 300;
  const normalized = await sharp(imageBuffer, { limitInputPixels: 180_000_000 })
    .rotate()
    .png()
    .withMetadata({ density: dpi })
    .toBuffer({ resolveWithObject: true });
  imageBuffer = normalized.data;
  const { width, height } = normalized.info;
  if (!width || !height || width * height > 180_000_000) {
    throw new Error("Les dimensions de la maquette sont invalides ou dépassent la limite de 180 mégapixels.");
  }
  const preview = await sharp(imageBuffer, { limitInputPixels: 180_000_000 })
    .resize({ width: 1200, height: 900, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const snapshotDirectory = path.join(app.getPath("temp"), "gnva-sticker-studio");
  await fs.mkdir(snapshotDirectory, { recursive: true });
  const jobPath = path.join(snapshotDirectory, `maquette-${crypto.randomUUID()}.png`);
  await fs.writeFile(jobPath, imageBuffer);
  const previousSnapshot = importedDesignSnapshot;
  importedDesignSnapshot = jobPath;
  if (previousSnapshot) await fs.rm(previousSnapshot, { force: true });
  return {
    width,
    height,
    dataUrl: `data:image/png;base64,${preview.toString("base64")}`,
    pdfSource: ext === ".pdf",
    dpi,
    jobPath,
  };
});

ipcMain.handle("job:start", async (event, config) => {
  const jobId = crypto.randomUUID();
  const abortController = new AbortController();
  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, { jobId, ...payload });
  };
  const job = { abortController, outputPath: null };
  activeJobs.set(jobId, job);

  startStickerJob(config, {
    signal: abortController.signal,
    onOutputPath: (value) => {
      job.outputPath = value;
      send("job:output", { outputPath: value });
    },
    onProgress: (progress) => send("job:progress", progress),
  })
    .then((result) => send("job:complete", { result }))
    .catch((error) => send("job:complete", { error: error.message || String(error) }))
    .finally(() => activeJobs.delete(jobId));

  return { jobId };
});

ipcMain.handle("job:cancel", async (_event, jobId) => {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.abortController.abort();
  return true;
});

ipcMain.handle("folder:open", async (_event, directory) => {
  if (typeof directory !== "string") return;
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
});
