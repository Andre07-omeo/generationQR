const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { openCsv, validateCsvFileHeaders, getStickerFields } = require("./csv");
const { safeFilename, createQrBuffer, renderStickerBuffer, writeOneFormat } = require("./render");

const ALLOWED_FORMATS = new Set(["jpg", "png", "tiff", "pdf", "webp", "gif", "avif"]);
const MAX_CONCURRENCY = 8;

function validateConfig(config) {
  if (!config || !config.csvPath || !config.designPath || !config.outputPath) {
    throw new Error("Sélectionnez un CSV, un design et un dossier de sortie.");
  }
  if (!Array.isArray(config.formats) || !config.formats.length) {
    throw new Error("Choisissez au moins un format d’export.");
  }
  if (config.formats.some((format) => !ALLOWED_FORMATS.has(format))) {
    throw new Error("Un des formats d’export n’est pas pris en charge.");
  }
  const numeric = ["width", "height", "qrX", "qrY", "qrSize", "numberX", "numberY", "fontSize", "dpi"];
  for (const key of numeric) {
    if (!Number.isFinite(Number(config[key]))) throw new Error(`Valeur invalide : ${key}`);
  }
  if (config.qrSize < 24 || config.qrSize > Math.min(config.width, config.height)) {
    throw new Error("La taille du QR code est trop petite ou dépasse le design.");
  }
  if (
    config.qrX < 0 ||
    config.qrY < 0 ||
    config.qrX + config.qrSize > config.width ||
    config.qrY + config.qrSize > config.height
  ) {
    throw new Error("Le QR code doit rester entièrement dans le design.");
  }
  if (config.width * config.height > 180_000_000) {
    throw new Error("Le design dépasse la limite de sécurité de 180 mégapixels.");
  }
}

async function createRunDirectory(outputPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const prefix = path.join(outputPath, `GNVA-${stamp}`);
  let candidate = prefix;
  let suffix = 1;
  while (true) {
    try {
      await fsp.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      candidate = `${prefix}-${suffix++}`;
    }
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeStreamLine(stream, line) {
  if (stream.write(`${line}\r\n`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      stream.off("drain", onDrain);
      reject(error);
    };
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    stream.once("error", onError);
    stream.once("drain", onDrain);
  });
}

async function startStickerJob(config, { signal, onProgress, onOutputPath }) {
  validateConfig(config);
  await validateCsvFileHeaders(config.csvPath);
  const requestedConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(config.concurrency) || 1));
  const pixelLimitedConcurrency = Math.max(1, Math.floor(32_000_000 / (Number(config.width) * Number(config.height))));
  const concurrency = Math.min(requestedConcurrency, pixelLimitedConcurrency);
  const formats = [...new Set(config.formats)];
  const outputRoot = await createRunDirectory(config.outputPath);
  onOutputPath(outputRoot);

  const designBuffer = await fsp.readFile(config.designPath);
  const settings = {
    width: Number(config.width),
    height: Number(config.height),
    qrX: Number(config.qrX),
    qrY: Number(config.qrY),
    qrSize: Number(config.qrSize),
    numberX: Number(config.numberX),
    numberY: Number(config.numberY),
    fontSize: Number(config.fontSize),
    font: String(config.font || "Arial").slice(0, 80),
    fontWeight: config.fontWeight === "bold" ? "bold" : "normal",
    numberColor: config.numberColor || "#111111",
    showNumber: Boolean(config.showNumber),
    dpi: Math.max(72, Math.min(1200, Number(config.dpi) || 300)),
    jpegQuality: Math.max(90, Math.min(100, Number(config.jpegQuality) || 95)),
    webpQuality: Math.max(80, Math.min(100, Number(config.webpQuality) || 94)),
  };

  const { source, parser } = await openCsv(config.csvPath);
  const errorsPath = path.join(outputRoot, "erreurs.csv");
  const errorsStream = fs.createWriteStream(errorsPath, { encoding: "utf8" });
  const errorsStreamReady = new Promise((resolve, reject) => {
    errorsStream.once("open", resolve);
    errorsStream.once("error", reject);
  });
  await errorsStreamReady;
  await writeStreamLine(errorsStream, "Ligne;Numero;Erreur");

  let startedAt = Date.now();
  let read = 0;
  let succeeded = 0;
  let failed = 0;
  let completed = 0;
  let errorWrites = Promise.resolve();
  let lastProgressAt = 0;
  let nextWriteId = 0;
  const pending = new Set();
  const maxPreviewErrors = [];
  const outputDirectoryCache = new Map();
  const updateProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 400 && completed % 100 !== 0) return;
    lastProgressAt = now;
    onProgress({
      read,
      completed,
      succeeded,
      failed,
      percent: read > 0 ? Math.floor((completed / read) * 100) : 0,
      message: `${succeeded.toLocaleString("fr-FR")} réussis · ${failed.toLocaleString("fr-FR")} erreurs`,
      elapsedSeconds: Math.floor((now - startedAt) / 1000),
      outputPath: outputRoot,
    });
  };

  const processRow = async (row, rowNumber) => {
    try {
      if (signal.aborted) return;
      const { url, number } = getStickerFields(row);
      if (!url) throw new Error("URL manquante dans la colonne urlPublique.");
      if (!number) throw new Error("Numéro manquant dans la colonne numeroAffiche.");
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("URL invalide dans la colonne urlPublique.");
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("L’URL de la colonne urlPublique doit commencer par http:// ou https://.");
      }
      const qrBuffer = await createQrBuffer(url, settings.qrSize);
      const numbered = String(rowNumber).padStart(7, "0");
      const base = `${numbered}__${safeFilename(number || `autocollant_${numbered}`)}`;
      const rowSettings = { ...settings, currentNumber: number };
      const masterBuffer = await renderStickerBuffer(designBuffer, qrBuffer, rowSettings, number);
      for (const format of formats) {
        if (signal.aborted) break;
        await writeOneFormat({
          format,
          outputRoot,
          index: rowNumber,
          baseName: base,
          masterBuffer,
          settings: rowSettings,
          directoryCache: outputDirectoryCache,
        });
      }
      if (!signal.aborted) succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = String(error?.message || error).replace(/[\r\n]+/g, " ").slice(0, 500);
      if (maxPreviewErrors.length < 12) {
        maxPreviewErrors.push({ row: rowNumber, message });
      }
      errorWrites = errorWrites.then(() =>
        writeStreamLine(errorsStream, `${rowNumber};${csvCell(getStickerFields(row).number)};${csvCell(message)}`),
      );
    } finally {
      if (!signal.aborted) completed += 1;
      updateProgress();
    }
  };

  try {
    for await (const row of parser) {
      if (signal.aborted) {
        source.destroy();
        break;
      }
      read += 1;
      while (pending.size >= concurrency) await Promise.race(pending);
      if (signal.aborted) break;
      const task = processRow(row, read).catch((error) => {
        failed += 1;
        completed += 1;
        if (maxPreviewErrors.length < 12) {
          maxPreviewErrors.push({ row: read, message: error.message || String(error) });
        }
      });
      pending.add(task);
      task.then(() => pending.delete(task));
    }
    await Promise.all(pending);
    await errorWrites;
  } finally {
    source.destroy();
  }

  await new Promise((resolve, reject) => {
    errorsStream.once("error", reject);
    errorsStream.end(resolve);
  });

  const result = {
    total: read,
    completed,
    succeeded,
    failed,
    cancelled: signal.aborted,
    formats,
    concurrency,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    outputPath: outputRoot,
    errorPreview: maxPreviewErrors,
    requestedConcurrency,
    effectiveConcurrency: concurrency,
    designMegapixels: Number(((settings.width * settings.height) / 1_000_000).toFixed(2)),
  };
  await fsp.writeFile(path.join(outputRoot, "rapport.json"), JSON.stringify(result, null, 2));
  updateProgress(true);
  return result;
}

module.exports = { startStickerJob, validateConfig };
