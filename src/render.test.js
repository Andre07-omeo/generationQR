const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const jsQR = require("jsqr");
const { safeFilename, createQrBuffer, getQrMinimumSize } = require("./render");
const { validateConfig } = require("./batch");

test("le QR avec logo central reste décodable et impose une taille minimale", async () => {
  const url = "http://localhost:3000/autocollant/gnva-ab-2026/123456789";
  const minimumSize = getQrMinimumSize(url);
  assert.ok(minimumSize > 0);
  await assert.rejects(() => createQrBuffer(url, minimumSize - 1), /QR trop petit/i);

  const qrBuffer = await createQrBuffer(url, Math.max(320, minimumSize));
  const { data, info } = await sharp(qrBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "dontInvert" });
  assert.equal(decoded?.data, url);
});

test("rend un nom de fichier sûr et reste unique grâce au préfixe de ligne", () => {
  assert.equal(safeFilename('GNVA: A/01? "test".'), "GNVA__A_01___test_");
});

test("refuse les lots sans format ou avec un QR hors du design", () => {
  const base = {
    csvPath: "/tmp/input.csv",
    designPath: "/tmp/design.png",
    outputPath: "/tmp/out",
    formats: ["png"],
    width: 1000,
    height: 1000,
    qrX: 0,
    qrY: 0,
    qrSize: 240,
    numberX: 500,
    numberY: 800,
    fontSize: 40,
    dpi: 300,
  };
  assert.doesNotThrow(() => validateConfig(base));
  assert.throws(() => validateConfig({ ...base, formats: [] }), /format/i);
  assert.throws(() => validateConfig({ ...base, qrX: 900 }), /QR code/i);
});
