const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  countCsvRows,
  previewCsvRows,
  inspectCsvFile,
  validateStickerHeaders,
  getStickerFields,
  isLocalUrl,
} = require("./csv");

test("lit un CSV français séparé par des points-virgules", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "gnva-csv-"));
  const file = path.join(folder, "contacts.csv");
  await fs.writeFile(
    file,
    "\uFEFFnumero;serie;numeroAffiche;urlPublique;zone;typeAutocollant\r\nA-01;AB;A-01/AB;https://example.com/1;lukunga;AUTOCOLLANT_2R\r\nA-02;AB;A-02/AB;https://example.com/2;lukunga;AUTOCOLLANT_2R\r\n",
  );
  try {
    assert.equal(await countCsvRows(file), 2);
    const inspected = await inspectCsvFile(file, 1);
    assert.equal(inspected.total, 2);
    assert.deepEqual(inspected.preview, [{ url: "https://example.com/1", number: "A-01/AB" }]);
    const [row] = await previewCsvRows(file, 1);
    assert.deepEqual(getStickerFields(row), { url: "https://example.com/1", number: "A-01/AB" });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("reconnaît un CSV à virgules et les deux colonnes attendues sans tenir compte de la casse", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "gnva-csv-"));
  const file = path.join(folder, "links.csv");
  await fs.writeFile(file, 'NUMEROAFFICHE,URLPUBLIQUE\n"0001/AB","https://example.com/a,b"\n');
  try {
    const inspected = await inspectCsvFile(file);
    assert.equal(inspected.total, 1);
    assert.deepEqual(inspected.preview, [{ url: "https://example.com/a,b", number: "0001/AB" }]);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("refuse les fichiers qui ne contiennent pas les colonnes numeroAffiche et urlPublique", () => {
  assert.throws(
    () => validateStickerHeaders(["id", "URL"]),
    /numeroAffiche et urlPublique/,
  );
});

test("rejette les alias à la place des colonnes GNVA", () => {
  assert.throws(
    () => validateStickerHeaders(["numero", "url"]),
    /numeroAffiche et urlPublique/,
  );
});

test("repère les URL locales qui ne sont pas accessibles depuis un téléphone externe", () => {
  assert.equal(isLocalUrl("http://localhost:3000/autocollant/abc"), true);
  assert.equal(isLocalUrl("http://192.168.1.10/autocollant/abc"), true);
  assert.equal(isLocalUrl("https://gnva.example.org/autocollant/abc"), false);
});
