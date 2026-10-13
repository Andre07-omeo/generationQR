const $ = (id) => document.getElementById(id);

const state = {
  designPath: null,
  design: null,
  csvPath: null,
  csvTotal: 0,
  localUrlCount: 0,
  outputPath: null,
  jobId: null,
  currentOutput: null,
  previewQrUrl: null,
  qrMinimumSize: 0,
  qrPreviewError: null,
  qrPreviewRequest: 0,
  dragTarget: null,
  dragOffset: { x: 0, y: 0 },
  qr: { x: 0, y: 0, size: 0 },
  number: { x: 0, y: 0 },
};
const unsubscribe = [];

const fileName = (value) => value?.split(/[\\/]/).pop() || "";
const numberValue = (id, fallback = 0) => {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
};

function setBusy(busy) {
  $("cancel-job").hidden = !busy;
  $("choose-design").disabled = busy;
  $("choose-csv").disabled = busy;
  $("choose-output").disabled = busy;
  $("confirm-local-url-test").disabled = busy;
  $("generate").disabled = busy || !state.design || !state.csvPath || !state.outputPath;
  if (!busy) updateEstimate();
}

function updateQrQualityWarning() {
  const warning = $("qr-quality-warning");
  if (!state.csvPath) {
    warning.hidden = true;
    warning.textContent = "";
    return false;
  }
  if (state.qrPreviewError) {
    warning.textContent = state.qrPreviewError;
    warning.hidden = false;
    return true;
  }
  if (state.design && state.qrMinimumSize) {
    const requestedSize = Math.round((numberValue("qr-size", 24) / 100) * state.design.width);
    if (requestedSize < state.qrMinimumSize) {
      warning.textContent =
        `QR trop petit pour une lecture fiable : ${requestedSize} px actuellement, ` +
        `${state.qrMinimumSize} px minimum pour la première URL. Augmentez sa dimension.`;
      warning.hidden = false;
      return true;
    }
  }
  warning.hidden = true;
  warning.textContent = "";
  return false;
}

function drawOverlay() {
  if (!state.design) return;
  const { width, height } = state.design;
  const maxQrPercent = Math.max(1, Math.min(100, Math.floor((Math.min(width, height) / width) * 100)));
  $("qr-size").max = String(maxQrPercent);
  if (numberValue("qr-size", 24) > maxQrPercent) $("qr-size").value = String(maxQrPercent);
  const qrPercent = numberValue("qr-size", 24);
  const qrSize = Math.round((qrPercent / 100) * width);
  state.qr.size = qrSize;
  state.qr.x = Math.min(Math.max(0, numberValue("qr-x")), Math.max(0, width - qrSize));
  state.qr.y = Math.min(Math.max(0, numberValue("qr-y")), Math.max(0, height - qrSize));
  state.number.x = Math.min(Math.max(0, numberValue("number-x")), width);
  state.number.y = Math.min(Math.max(0, numberValue("number-y")), height);
  $("qr-x").value = String(state.qr.x);
  $("qr-y").value = String(state.qr.y);
  $("number-x").value = String(state.number.x);
  $("number-y").value = String(state.number.y);

  $("qr-size-value").textContent = `${qrPercent} %`;
  $("qr-overlay").style.left = `${(state.qr.x / width) * 100}%`;
  $("qr-overlay").style.top = `${(state.qr.y / height) * 100}%`;
  $("qr-overlay").style.width = `${(qrSize / width) * 100}%`;
  $("qr-overlay").style.aspectRatio = "1";
  $("number-overlay").style.left = `${(state.number.x / width) * 100}%`;
  $("number-overlay").style.top = `${(state.number.y / height) * 100}%`;
  $("number-overlay").style.fontSize = `${Math.max(9, (numberValue("font-size", 42) / width) * 100)}cqw`;
  $("number-overlay").style.fontWeight = $("font-bold").checked ? "700" : "400";
  $("number-overlay").style.fontFamily = $("font").value;
  $("number-overlay").style.color = $("number-color").value;
  $("number-overlay").hidden = !$("show-number").checked;
  $("number-fields").classList.toggle("disabled-fields", !$("show-number").checked);
  $("number-overlay").textContent = state.csvTotal ? "Exemple" : "000001";
  updateEstimate();
}

function updateEstimate() {
  const selected = [...document.querySelectorAll(".format-choice input:checked")].map((input) => input.value);
  const localLinksConfirmed = !state.localUrlCount || $("confirm-local-url-test").checked;
  const qrTooSmall = updateQrQualityWarning();
  const go = Boolean(
    state.design && state.csvPath && state.outputPath && selected.length &&
    !state.jobId && localLinksConfirmed && !qrTooSmall,
  );
  $("generate").disabled = !go;
  if (!state.csvPath) {
    $("estimate").textContent = "Choisissez un CSV pour préparer le lot.";
    return;
  }
  if (!selected.length) {
    $("estimate").textContent = "Sélectionnez au moins un format.";
    return;
  }
  if (!localLinksConfirmed) {
    $("estimate").textContent = "Corrigez les URL locales ou confirmez qu’il s’agit d’un test.";
    return;
  }
  if (qrTooSmall) {
    $("estimate").textContent = state.qrPreviewError
      ? "Aperçu QR impossible : vérifiez l’URL publique du CSV."
      : "Augmentez la dimension du QR pour garantir sa lecture.";
    return;
  }
  if (state.design) {
    const megapixels = (state.design.width * state.design.height) / 1_000_000;
    const factors = { jpg: 0.18, png: 0.45, tiff: 0.9, pdf: 0.28, webp: 0.14, gif: 0.12, avif: 0.12 };
    const mb = selected.reduce((sum, format) => sum + factors[format] * megapixels, 0) * state.csvTotal;
    const estimate = mb >= 1000 ? `≈ ${(mb / 1000).toFixed(1)} Go` : `≈ ${Math.max(1, Math.round(mb))} Mo`;
    $("estimate").textContent = `${state.csvTotal.toLocaleString("fr-FR")} autocollant${state.csvTotal > 1 ? "s" : ""} · ${selected.length} format${selected.length > 1 ? "s" : ""} · ${estimate} estimés`;
  } else {
    $("estimate").textContent = `${state.csvTotal.toLocaleString("fr-FR")} lignes · ${selected.length} format${selected.length > 1 ? "s" : ""}`;
  }
}

function drawCsvPreview(rows) {
  const sample = $("csv-sample");
  sample.replaceChildren();
  for (const row of rows.slice(0, 3)) {
    const line = document.createElement("span");
    line.textContent = `N° ${row.number || "—"}  ·  ${row.url || "URL absente"}`;
    sample.append(line);
  }
}

async function loadQrPreview(url) {
  const requestId = ++state.qrPreviewRequest;
  state.previewQrUrl = typeof url === "string" ? url : null;
  state.qrMinimumSize = 0;
  state.qrPreviewError = "Vérification du QR de la première ligne…";
  $("qr-overlay-image").removeAttribute("src");
  if (!state.previewQrUrl) {
    state.qrPreviewError = "Aucune URL exploitable dans la colonne urlPublique.";
    updateEstimate();
    return;
  }
  updateEstimate();
  try {
    const preview = await window.gnva.previewQr(state.previewQrUrl);
    if (requestId !== state.qrPreviewRequest) return;
    $("qr-overlay-image").src = preview.dataUrl;
    state.qrMinimumSize = Number(preview.minimumSize) || 0;
    state.qrPreviewError = null;
  } catch (error) {
    if (requestId !== state.qrPreviewRequest) return;
    state.qrPreviewError = `Impossible de préparer le QR de la première ligne : ${error.message}`;
  }
  updateEstimate();
}

async function chooseCsv() {
  const csvPath = await window.gnva.chooseCsv();
  if (!csvPath) return;
  state.qrPreviewRequest += 1;
  state.csvPath = null;
  state.csvTotal = 0;
  state.localUrlCount = 0;
  state.previewQrUrl = null;
  state.qrMinimumSize = 0;
  state.qrPreviewError = null;
  $("confirm-local-url-test").checked = false;
  $("csv-url-warning").hidden = true;
  $("csv-summary").hidden = true;
  $("csv-status").textContent = "Lecture du fichier…";
  try {
    const result = await window.gnva.inspectCsv(csvPath);
    if (!result.total) throw new Error("Le CSV ne contient aucune ligne de données.");
    state.csvPath = csvPath;
    state.csvTotal = result.total;
    state.localUrlCount = result.localUrlCount || 0;
    $("csv-status").textContent = fileName(csvPath);
    $("csv-count").textContent = result.total.toLocaleString("fr-FR");
    $("csv-summary").hidden = false;
    $("csv-url-warning").hidden = state.localUrlCount === 0;
    if (state.localUrlCount) {
      $("csv-url-warning-copy").textContent =
        `${state.localUrlCount.toLocaleString("fr-FR")} adresse(s) désignent cet ordinateur ou un réseau privé. Un QR avec localhost ne fonctionnera pas sur un téléphone. Corrigez le CSV pour la production ; la génération reste bloquée jusqu’à confirmation d’un test local.`;
    }
    drawCsvPreview(result.preview);
    await loadQrPreview(result.preview?.[0]?.url);
    updateEstimate();
  } catch (error) {
    state.csvPath = null;
    state.csvTotal = 0;
    state.localUrlCount = 0;
    $("csv-summary").hidden = true;
    $("csv-status").textContent = "Lecture impossible";
    updateEstimate();
    showResult({ error: error.message, outputPath: null });
  }
}

async function chooseDesign() {
  const designPath = await window.gnva.chooseDesign();
  if (!designPath) return;
  $("design-status").textContent = "Chargement…";
  try {
    const design = await window.gnva.inspectDesign(designPath);
    state.designPath = design.jobPath;
    state.design = design;
    $("qr-size").value = "24";
    $("qr-x").value = String(Math.round(design.width * 0.08));
    $("qr-y").value = String(Math.round(design.height * 0.08));
    $("number-x").value = String(Math.round(design.width * 0.5));
    $("number-y").value = String(Math.round(design.height * 0.88));
    drawOverlay();
    const previewImage = $("preview-image");
    previewImage.onload = () => {
      $("preview-empty").hidden = true;
      $("preview-scroll").hidden = false;
      fitPreview();
      $("preview-stage").style.containerType = "inline-size";
      $("design-dimensions").textContent = `${design.width.toLocaleString("fr-FR")} × ${design.height.toLocaleString("fr-FR")} px · verrouillées`;
      $("design-status").textContent = `${fileName(designPath)} · verrouillée`;
      $("design-dpi").textContent = `${design.dpi} DPI`;
      $("quality-note").textContent = design.pdfSource ? "Première page conservée à 300 DPI" : "Maquette source non modifiée";
      drawOverlay();
    };
    previewImage.src = design.dataUrl;
  } catch (error) {
    state.design = null;
    state.designPath = null;
    $("design-status").textContent = "Fichier non pris en charge";
    showResult({ error: error.message, outputPath: null });
  }
}

async function chooseOutput() {
  const outputPath = await window.gnva.chooseOutput();
  if (!outputPath) return;
  state.outputPath = outputPath;
  $("output-status").textContent = outputPath;
  $("output-status").title = outputPath;
  updateEstimate();
}

function fitPreview() {
  if (!state.design || $("preview-scroll").hidden) return;
  const area = $("preview-scroll");
  const stage = $("preview-stage");
  const availableWidth = Math.max(1, area.clientWidth - 30);
  const availableHeight = Math.max(1, area.clientHeight - 46);
  const scale = Math.min(1, availableWidth / state.design.width, availableHeight / state.design.height);
  const displayWidth = Math.max(1, state.design.width * scale);
  const displayHeight = Math.max(1, state.design.height * scale);
  stage.style.width = `${displayWidth}px`;
  stage.style.height = `${displayHeight}px`;
  $("preview-image").style.width = `${displayWidth}px`;
  $("preview-image").style.height = `${displayHeight}px`;
}

function getConfig() {
  const qrSize = Math.round((numberValue("qr-size", 24) / 100) * state.design.width);
  return {
    csvPath: state.csvPath,
    designPath: state.designPath,
    outputPath: state.outputPath,
    width: state.design.width,
    height: state.design.height,
    qrX: Math.max(0, numberValue("qr-x")),
    qrY: Math.max(0, numberValue("qr-y")),
    qrSize,
    numberX: Math.max(0, numberValue("number-x")),
    numberY: Math.max(0, numberValue("number-y")),
    fontSize: Math.max(8, numberValue("font-size", 42)),
    font: $("font").value,
    fontWeight: $("font-bold").checked ? "bold" : "normal",
    numberColor: $("number-color").value,
    showNumber: $("show-number").checked,
    formats: [...document.querySelectorAll(".format-choice input:checked")].map((input) => input.value),
    jpegQuality: numberValue("jpeg-quality", 95),
    dpi: state.design.dpi,
    concurrency: numberValue("concurrency", 4),
  };
}

const previewResizeObserver = new ResizeObserver(() => {
  fitPreview();
  drawOverlay();
});
previewResizeObserver.observe($("preview-scroll"));

async function launchJob() {
  const config = getConfig();
  if (!config.formats.length) return;
  $("result-panel").hidden = true;
  $("progress-panel").hidden = false;
  $("progress-title").textContent = "Préparation du lot";
  $("progress-percent").textContent = "0%";
  $("progress-fill").style.width = "0%";
  $("progress-count").textContent = "Ouverture du CSV…";
  $("progress-speed").textContent = `${config.concurrency} tâches simultanées`;
  $("progress-output").textContent = "";
  state.currentOutput = null;
  state.jobId = "starting";
  setBusy(true);
  try {
    const { jobId } = await window.gnva.startJob(config);
    state.jobId = jobId;
  } catch (error) {
    state.jobId = null;
    setBusy(false);
    showResult({ error: error.message, outputPath: null });
  }
}

function showResult({ result, error, outputPath }) {
  $("result-panel").hidden = false;
  $("result-mark").textContent = error ? "!" : result?.cancelled ? "Ⅱ" : "✓";
  $("result-mark").classList.toggle("failed", Boolean(error));
  $("result-eyebrow").textContent = error ? "VÉRIFICATION REQUISE" : result?.cancelled ? "LOT ARRÊTÉ" : "LOT TERMINÉ";
  $("result-title").textContent = error
    ? "La génération n’a pas démarré"
    : result?.cancelled
      ? "Le lot a été arrêté"
      : "Votre lot est prêt";
  $("result-summary").textContent = error
    ? error
    : `${result.succeeded.toLocaleString("fr-FR")} réussi(s) · ${result.failed.toLocaleString("fr-FR")} erreur(s) · ${result.elapsedSeconds.toLocaleString("fr-FR")} s`;
  const location = result?.outputPath || outputPath;
  $("result-path").textContent = location || "";
  $("result-path").title = location || "";
  $("open-output").disabled = !location;
  $("result-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateCoordinatesFromDrag(target, event) {
  const rect = $("preview-stage").getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = ((event.clientX - rect.left) / rect.width) * state.design.width;
  const y = ((event.clientY - rect.top) / rect.height) * state.design.height;
  if (target === "qr") {
    $("qr-x").value = Math.round(Math.max(0, Math.min(state.design.width - state.qr.size, x - state.dragOffset.x)));
    $("qr-y").value = Math.round(Math.max(0, Math.min(state.design.height - state.qr.size, y - state.dragOffset.y)));
  } else {
    $("number-x").value = Math.round(Math.max(0, Math.min(state.design.width, x - state.dragOffset.x)));
    $("number-y").value = Math.round(Math.max(0, Math.min(state.design.height, y - state.dragOffset.y)));
  }
  drawOverlay();
}

$("choose-design").addEventListener("click", chooseDesign);
$("choose-csv").addEventListener("click", chooseCsv);
$("choose-output").addEventListener("click", chooseOutput);
$("generate").addEventListener("click", launchJob);
$("cancel-job").addEventListener("click", async () => {
  if (!state.jobId || state.jobId === "starting") return;
  $("cancel-job").disabled = true;
  $("cancel-job").textContent = "Arrêt en cours…";
  await window.gnva.cancelJob(state.jobId);
});
$("open-output").addEventListener("click", async () => {
  const path = $("result-path").textContent;
  if (path) await window.gnva.openFolder(path);
});

for (const id of ["qr-x", "qr-y", "qr-size", "number-x", "number-y", "font-size", "font", "number-color", "font-bold", "show-number"]) {
  $(id).addEventListener("input", drawOverlay);
  $(id).addEventListener("change", drawOverlay);
}
for (const input of document.querySelectorAll(".format-choice input")) {
  input.addEventListener("change", updateEstimate);
}
$("confirm-local-url-test").addEventListener("change", updateEstimate);
for (const id of ["jpeg-quality", "concurrency"]) {
  $(id).addEventListener("input", () => {
    if (id === "concurrency") $("concurrency-value").textContent = $(id).value;
    updateEstimate();
  });
}
for (const [element, target] of [[$("qr-overlay"), "qr"], [$("number-overlay"), "number"]]) {
  element.addEventListener("pointerdown", (event) => {
    if (!state.design || (target === "number" && !$("show-number").checked)) return;
    state.dragTarget = target;
    const position = target === "qr" ? state.qr : state.number;
    const rect = $("preview-stage").getBoundingClientRect();
    state.dragOffset = {
      x: ((event.clientX - rect.left) / rect.width) * state.design.width - position.x,
      y: ((event.clientY - rect.top) / rect.height) * state.design.height - position.y,
    };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  element.addEventListener("pointermove", (event) => {
    if (state.dragTarget === target) updateCoordinatesFromDrag(target, event);
  });
  element.addEventListener("pointerup", () => {
    state.dragTarget = null;
  });
  element.addEventListener("pointercancel", () => {
    state.dragTarget = null;
  });
}

unsubscribe.push(window.gnva.onProgress((event) => {
  if (event.jobId !== state.jobId) return;
  $("progress-title").textContent = event.read
    ? `${event.completed.toLocaleString("fr-FR")} autocollant(s) traités`
    : "Préparation du lot";
  $("progress-percent").textContent = `${Math.min(100, event.percent)}%`;
  $("progress-fill").style.width = `${Math.min(100, event.percent)}%`;
  $("progress-count").textContent = `${event.completed.toLocaleString("fr-FR")} terminés · ${event.read.toLocaleString("fr-FR")} lus`;
  $("progress-speed").textContent = `${event.elapsedSeconds} s · ${event.message}`;
  if (event.outputPath) $("progress-output").textContent = event.outputPath;
}));

unsubscribe.push(window.gnva.onOutput((event) => {
  if (event.jobId !== state.jobId) return;
  state.currentOutput = event.outputPath;
}));

unsubscribe.push(window.gnva.onComplete((event) => {
  if (event.jobId !== state.jobId) return;
  state.jobId = null;
  setBusy(false);
  $("cancel-job").disabled = false;
  $("cancel-job").textContent = "Arrêter le lot";
  $("progress-panel").hidden = true;
  if (event.error) {
    showResult({ error: event.error, outputPath: state.currentOutput });
    return;
  }
  showResult({ result: event.result, outputPath: state.currentOutput });
}));

window.addEventListener("beforeunload", () => {
  for (const removeListener of unsubscribe) removeListener();
});

updateEstimate();
