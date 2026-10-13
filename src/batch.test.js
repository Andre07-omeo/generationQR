const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const jsQR = require("jsqr");
const { startStickerJob } = require("./batch");

test("génère les formats sélectionnés sans écraser les numéros identiques", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "gnva-batch-"));
  const designPath = path.join(folder, "design.svg");
  const csvPath = path.join(folder, "data.csv");
  const outputPath = path.join(folder, "exports");
  await fs.mkdir(outputPath);
  await fs.writeFile(
    designPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#f0eadc"/></svg>',
  );
  await fs.writeFile(
    csvPath,
    "numero;serie;numeroAffiche;urlPublique;zone;typeAutocollant\nIGNORE;AB;MEME/AB;https://example.com/alpha;lukunga;AUTOCOLLANT_2R\nIGNORE;AB;MEME/AB;https://example.com/beta;lukunga;AUTOCOLLANT_2R\n",
  );

  try {
    const result = await startStickerJob(
      {
        csvPath,
        designPath,
        outputPath,
        width: 320,
        height: 320,
        qrX: 10,
        qrY: 10,
        qrSize: 256,
        numberX: 160,
        numberY: 280,
        fontSize: 18,
        font: "Arial",
        fontWeight: "bold",
        numberColor: "#222222",
        showNumber: true,
        formats: ["jpg", "png", "tiff", "webp", "pdf", "gif", "avif"],
        dpi: 300,
        jpegQuality: 95,
        concurrency: 2,
      },
      { signal: new AbortController().signal, onOutputPath() {}, onProgress() {} },
    );

    assert.equal(result.total, 2);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);
    for (const format of ["JPG", "PNG", "TIFF", "WEBP", "PDF", "GIF", "AVIF"]) {
      const batchFolder = path.join(result.outputPath, format, "0000001-0001000");
      const files = await fs.readdir(batchFolder);
      assert.equal(files.length, 2, `${format} should include both CSV rows`);
      assert.notEqual(files[0], files[1]);
    }
    const pngPath = path.join(result.outputPath, "PNG", "0000001-0001000", "0000001__MEME_AB.png");
    const pngMetadata = await sharp(pngPath).metadata();
    assert.equal(pngMetadata.width, 320);
    assert.equal(pngMetadata.height, 320);
    assert.equal(pngMetadata.density, 300);
    const qrPixels = await sharp(pngPath)
      .extract({ left: 10, top: 10, width: 256, height: 256 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decodedQr = jsQR(
      new Uint8ClampedArray(qrPixels.data),
      qrPixels.info.width,
      qrPixels.info.height,
      { inversionAttempts: "dontInvert" },
    );
    assert.equal(decodedQr?.data, "https://example.com/alpha");
    const report = JSON.parse(await fs.readFile(path.join(result.outputPath, "rapport.json"), "utf8"));
    assert.deepEqual(report.formats, ["jpg", "png", "tiff", "webp", "pdf", "gif", "avif"]);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
