const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode-svg");
const sharp = require("sharp");
const QR_LOGO = fs.readFileSync(path.join(__dirname, "../assets/qr-center-logo.png"));

sharp.cache(false);
sharp.concurrency(1);

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeFilename(value) {
  const cleaned = String(value)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 70);
  return cleaned || "autocollant";
}

function numberOverlay(number, settings) {
  const family = xmlEscape(settings.font);
  const color = /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : "#111111";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}" height="${settings.height}">` +
    `<text x="${settings.x}" y="${settings.y}" font-family="${family}" font-size="${settings.fontSize}" ` +
    `font-weight="${settings.fontWeight}" fill="${color}" text-anchor="middle" dominant-baseline="central">` +
    `${xmlEscape(number)}</text></svg>`;
  return Buffer.from(svg);
}

function makeQrSvg(url, size) {
  return new QRCode({
    content: String(url),
    padding: 4,
    width: size,
    height: size,
    color: "#000000",
    background: "#ffffff",
    ecl: "H",
    container: "svg",
  }).svg();
}

function getQrMinimumSizeFromSvg(svg, size) {
  const rectangles = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)];
  const firstModule = rectangles.find((match) => Number(match[1]) > 0);
  const moduleSize = Number(firstModule?.[2]);
  if (!moduleSize) throw new Error("La géométrie du QR n’a pas pu être vérifiée.");
  const totalModules = Math.round(size / moduleSize);
  return Math.ceil(totalModules * 4);
}

function getQrMinimumSize(url) {
  const size = 1024;
  return getQrMinimumSizeFromSvg(makeQrSvg(url, size), size);
}

async function createQrBuffer(url, size, { allowBelowMinimum = false } = {}) {
  const side = Math.round(Number(size));
  if (!Number.isFinite(side) || side < 1) throw new Error("Taille de QR invalide.");
  const svg = makeQrSvg(url, side);
  const minimumSize = getQrMinimumSizeFromSvg(svg, side);
  if (!allowBelowMinimum && side < minimumSize) {
    throw new Error(`QR trop petit pour une lecture fiable : augmentez sa taille à ${minimumSize} px minimum.`);
  }

  const backingSize = Math.max(1, Math.round(side * 0.26));
  const logoSize = Math.max(1, Math.round(side * 0.16));
  const backingOffset = Math.floor((side - backingSize) / 2);
  const logoOffset = Math.floor((side - logoSize) / 2);
  const backingSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
      `<rect x="${backingOffset}" y="${backingOffset}" width="${backingSize}" height="${backingSize}" ` +
      `rx="${Math.round(backingSize * 0.16)}" fill="#ffffff"/></svg>`,
  );
  const logo = await sharp(QR_LOGO)
    .resize(logoSize, logoSize, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  return sharp(Buffer.from(svg))
    .composite([
      { input: backingSvg },
      { input: logo, left: logoOffset, top: logoOffset },
    ])
    .png()
    .toBuffer();
}

function stickerPipeline(designBuffer, qrBuffer, settings, number) {
  const overlays = [{
    input: qrBuffer,
    left: Math.round(settings.qrX),
    top: Math.round(settings.qrY),
  }];
  if (settings.showNumber && number) {
    overlays.push({
      input: numberOverlay(number, {
        width: settings.width,
        height: settings.height,
        x: settings.numberX,
        y: settings.numberY,
        fontSize: settings.fontSize,
        font: settings.font,
        fontWeight: settings.fontWeight,
        color: settings.numberColor,
      }),
      left: 0,
      top: 0,
    });
  }
  return sharp(designBuffer, { limitInputPixels: 180_000_000 })
    .composite(overlays)
    .withMetadata({ density: settings.dpi })
    .png({ compressionLevel: 3, adaptiveFiltering: false });
}

async function renderStickerBuffer(designBuffer, qrBuffer, settings, number) {
  return stickerPipeline(designBuffer, qrBuffer, settings, number).toBuffer();
}

async function writeOneFormat({ format, outputRoot, index, baseName, masterBuffer, settings, directoryCache }) {
  const folderStart = Math.floor((index - 1) / 1000) * 1000 + 1;
  const folderEnd = folderStart + 999;
  const batchFolder = `${String(folderStart).padStart(7, "0")}-${String(folderEnd).padStart(7, "0")}`;
  const directory = path.join(outputRoot, format.toUpperCase(), batchFolder);
  if (!directoryCache.has(directory)) {
    directoryCache.set(directory, fs.promises.mkdir(directory, { recursive: true }));
  }
  await directoryCache.get(directory);
  const outputPath = path.join(directory, `${baseName}.${format}`);
  if (format === "jpg") {
    await sharp(masterBuffer)
      .flatten({ background: "#FFFFFF" })
      .withMetadata({ density: settings.dpi })
      .jpeg({ quality: settings.jpegQuality, chromaSubsampling: "4:4:4" })
      .toFile(outputPath);
  } else if (format === "png") {
    await fs.promises.writeFile(outputPath, masterBuffer);
  } else if (format === "tiff") {
    await sharp(masterBuffer)
      .withMetadata({ density: settings.dpi })
      .tiff({
        compression: "lzw",
        predictor: "horizontal",
        quality: 100,
        xres: settings.dpi,
        yres: settings.dpi,
      })
      .toFile(outputPath);
  } else if (format === "webp") {
    await sharp(masterBuffer)
      .withMetadata({ density: settings.dpi })
      .webp({ quality: settings.webpQuality, effort: 4 })
      .toFile(outputPath);
  } else if (format === "gif") {
    await sharp(masterBuffer)
      .withMetadata({ density: settings.dpi })
      .gif({ effort: 4, colours: 256 })
      .toFile(outputPath);
  } else if (format === "avif") {
    await sharp(masterBuffer)
      .withMetadata({ density: settings.dpi })
      .avif({ quality: settings.avifQuality || 90, effort: 4 })
      .toFile(outputPath);
  } else if (format === "pdf") {
    const PDFDocument = require("pdfkit");
    const widthPoints = (settings.width / settings.dpi) * 72;
    const heightPoints = (settings.height / settings.dpi) * 72;
    const jpeg = await sharp(masterBuffer)
      .flatten({ background: "#FFFFFF" })
      .jpeg({ quality: settings.jpegQuality, chromaSubsampling: "4:4:4" })
      .toBuffer();
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: [widthPoints, heightPoints],
        margin: 0,
        autoFirstPage: true,
        compress: true,
      });
      const stream = fs.createWriteStream(outputPath);
      stream.once("finish", resolve);
      stream.once("error", reject);
      doc.once("error", reject);
      doc.pipe(stream);
      doc.image(jpeg, 0, 0, { width: widthPoints, height: heightPoints });
      doc.end();
    });
  }
  return outputPath;
}

module.exports = {
  safeFilename,
  createQrBuffer,
  getQrMinimumSize,
  renderStickerBuffer,
  writeOneFormat,
};
