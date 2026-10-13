const fs = require("node:fs");
const { parse } = require("csv-parse");

async function detectDelimiter(filePath) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const sample = Buffer.alloc(32768);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const firstLine = sample.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
    const candidates = [";", ",", "\t"];
    return candidates.reduce((best, current) => {
      const count = (firstLine.match(new RegExp(current === "\t" ? "\\t" : `\\${current}`, "g")) || []).length;
      const bestCount = (firstLine.match(new RegExp(best === "\t" ? "\\t" : `\\${best}`, "g")) || []).length;
      return count > bestCount ? current : best;
    }, ";");
  } finally {
    await handle.close();
  }
}

async function openCsv(filePath) {
  const delimiter = await detectDelimiter(filePath);
  const source = fs.createReadStream(filePath);
  let headers = [];
  const parser = source.pipe(
    parse({
      bom: true,
      columns: (values) => {
        headers = values.map((header) => header.trim());
        return headers;
      },
      delimiter,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    }),
  );
  parser.on("error", () => source.destroy());
  return { source, parser, delimiter, getHeaders: () => [...headers] };
}

async function countCsvRows(filePath) {
  const { source, parser } = await openCsv(filePath);
  let total = 0;
  try {
    for await (const _row of parser) total += 1;
    return total;
  } finally {
    source.destroy();
  }
}

async function previewCsvRows(filePath, limit = 5) {
  const { source, parser } = await openCsv(filePath);
  const rows = [];
  try {
    for await (const row of parser) {
      if (rows.length < limit) rows.push(row);
      else break;
    }
    return rows;
  } finally {
    source.destroy();
  }
}

function normalizedKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function validateStickerHeaders(headers) {
  const names = new Set(headers.map(normalizedKey));
  const missing = [];
  if (!names.has("numeroaffiche")) missing.push("numeroAffiche");
  if (!names.has("urlpublique")) missing.push("urlPublique");
  if (missing.length) {
    throw new Error(`CSV GNVA invalide. Colonnes obligatoires manquantes : ${missing.join(" et ")}.`);
  }
}

async function validateCsvFileHeaders(filePath) {
  const { source, parser, getHeaders } = await openCsv(filePath);
  try {
    await parser[Symbol.asyncIterator]().next();
    validateStickerHeaders(getHeaders());
  } finally {
    source.destroy();
  }
}

async function inspectCsvFile(filePath, limit = 5) {
  const { source, parser, getHeaders } = await openCsv(filePath);
  const preview = [];
  let total = 0;
  let localUrlCount = 0;
  try {
    for await (const row of parser) {
      if (total === 0) validateStickerHeaders(getHeaders());
      const fields = getStickerFields(row);
      if (isLocalUrl(fields.url)) localUrlCount += 1;
      if (preview.length < limit) preview.push(fields);
      total += 1;
    }
    validateStickerHeaders(getHeaders());
    return { total, preview, headers: getHeaders(), localUrlCount };
  } finally {
    source.destroy();
  }
}

function findColumn(row, column) {
  const entries = Object.entries(row);
  const entry = entries.find(([header]) => normalizedKey(header) === normalizedKey(column));
  return entry && entry[1] != null ? String(entry[1]).trim() : "";
}

function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
    const octets = host.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
    }
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    );
  } catch {
    return false;
  }
}

function getStickerFields(row) {
  return {
    url: findColumn(row, "urlPublique"),
    number: findColumn(row, "numeroAffiche"),
  };
}

module.exports = {
  openCsv,
  countCsvRows,
  previewCsvRows,
  inspectCsvFile,
  validateCsvFileHeaders,
  validateStickerHeaders,
  getStickerFields,
  isLocalUrl,
};
