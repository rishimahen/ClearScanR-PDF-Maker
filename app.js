const state = {
  sourceCanvas: document.createElement("canvas"),
  cleanedDataUrl: "",
  fileName: "clearscan-document",
  crop: true,
  stream: null
};

const fileInput = document.querySelector("#fileInput");
const cameraButton = document.querySelector("#cameraButton");
const captureButton = document.querySelector("#captureButton");
const installButton = document.querySelector("#installButton");
const pdfButton = document.querySelector("#pdfButton");
const imageButton = document.querySelector("#imageButton");
const resetButton = document.querySelector("#resetButton");
const modeSelect = document.querySelector("#modeSelect");
const cropOn = document.querySelector("#cropOn");
const cropOff = document.querySelector("#cropOff");
const emptyState = document.querySelector("#emptyState");
const cameraPreview = document.querySelector("#cameraPreview");
const resultCanvas = document.querySelector("#resultCanvas");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");

const controls = {
  brightness: document.querySelector("#brightnessRange"),
  contrast: document.querySelector("#contrastRange"),
  sharpness: document.querySelector("#sharpnessRange"),
  threshold: document.querySelector("#thresholdRange")
};

const outputs = {
  brightness: document.querySelector("#brightnessValue"),
  contrast: document.querySelector("#contrastValue"),
  sharpness: document.querySelector("#sharpnessValue"),
  threshold: document.querySelector("#thresholdValue")
};

let installPrompt = null;

registerServiceWorker();
showInstallFallback();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.classList.add("hidden");
  setStatus("App installed", "ready");
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.fileName = file.name.replace(/\.[^.]+$/, "") || "clearscan-document";
  stopCamera();
  await loadImageFile(file);
});

cameraButton.addEventListener("click", async () => {
  if (state.stream) {
    stopCamera();
    return;
  }
  await startCamera();
});

captureButton.addEventListener("click", () => {
  if (!state.stream || !cameraPreview.videoWidth) return;
  state.fileName = "camera-scan";
  copyVideoToSource();
  stopCamera(false);
  cleanScan();
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) {
    setStatus("Share > Add to Home", "ready");
    return;
  }
  installPrompt.prompt();
  const result = await installPrompt.userChoice;
  installPrompt = null;
  installButton.classList.add("hidden");
  setStatus(result.outcome === "accepted" ? "App installed" : "Ready", "ready");
});

pdfButton.addEventListener("click", () => {
  if (!state.cleanedDataUrl) return;
  downloadPdf();
});

imageButton.addEventListener("click", () => {
  if (!state.cleanedDataUrl) return;
  downloadBlob(dataUrlToBlob(state.cleanedDataUrl), `${state.fileName}-clean.jpg`);
});

resetButton.addEventListener("click", () => {
  resetScan();
});

modeSelect.addEventListener("change", cleanScan);

for (const [key, input] of Object.entries(controls)) {
  input.addEventListener("input", () => {
    outputs[key].value = input.value;
    cleanScan();
  });
}

cropOn.addEventListener("click", () => {
  state.crop = true;
  cropOn.classList.add("selected");
  cropOff.classList.remove("selected");
  cleanScan();
});

cropOff.addEventListener("click", () => {
  state.crop = false;
  cropOff.classList.add("selected");
  cropOn.classList.remove("selected");
  cleanScan();
});

window.ClearScanApp = {
  loadDataUrl,
  loadImageUrl
};

if (new URLSearchParams(window.location.search).get("demo") === "1") {
  loadImageUrl("sample-document.svg", "sample-document.svg");
}

async function loadImageFile(file) {
  setStatus("Cleaning scan", "busy");
  const image = new Image();
  image.decoding = "async";
  image.src = URL.createObjectURL(file);
  await image.decode();
  copyImageToSource(image);
  URL.revokeObjectURL(image.src);
  cleanScan();
}

async function loadDataUrl(dataUrl, fileName = "clearscan-document") {
  return loadImageSource(dataUrl, fileName);
}

async function loadImageUrl(url, fileName = "clearscan-document") {
  return loadImageSource(url, fileName);
}

async function loadImageSource(source, fileName) {
  setStatus("Cleaning scan", "busy");
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  await image.decode();
  state.fileName = fileName.replace(/\.[^.]+$/, "") || "clearscan-document";
  stopCamera();
  copyImageToSource(image);
  cleanScan();
}

async function startCamera() {
  try {
    setStatus("Opening camera", "busy");
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    cameraPreview.srcObject = state.stream;
    emptyState.classList.add("hidden");
    resultCanvas.classList.add("hidden");
    cameraPreview.classList.remove("hidden");
    captureButton.classList.remove("hidden");
    cameraButton.textContent = "Close";
    setStatus("Camera ready", "ready");
  } catch (error) {
    setStatus("Camera unavailable", "error");
  }
}

function stopCamera(showEmpty = true) {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  cameraPreview.srcObject = null;
  cameraPreview.classList.add("hidden");
  captureButton.classList.add("hidden");
  cameraButton.textContent = "Camera";
  if (showEmpty && !state.cleanedDataUrl) {
    emptyState.classList.remove("hidden");
  }
}

function copyImageToSource(image) {
  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight, 2600);
  state.sourceCanvas.width = width;
  state.sourceCanvas.height = height;
  state.sourceCanvas.getContext("2d").drawImage(image, 0, 0, width, height);
}

function copyVideoToSource() {
  const { width, height } = fitDimensions(cameraPreview.videoWidth, cameraPreview.videoHeight, 2600);
  state.sourceCanvas.width = width;
  state.sourceCanvas.height = height;
  state.sourceCanvas.getContext("2d").drawImage(cameraPreview, 0, 0, width, height);
}

function fitDimensions(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function cleanScan() {
  if (!state.sourceCanvas.width || !state.sourceCanvas.height) return;
  setStatus("Cleaning scan", "busy");
  window.requestAnimationFrame(() => {
    const crop = state.crop ? detectDocumentBounds(state.sourceCanvas) : fullBounds(state.sourceCanvas);
    const working = document.createElement("canvas");
    working.width = crop.width;
    working.height = crop.height;
    working.getContext("2d").drawImage(
      state.sourceCanvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    );

    const ctx = working.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, working.width, working.height);
    enhanceImage(imageData);
    ctx.putImageData(imageData, 0, 0);

    const sharpness = Number(controls.sharpness.value);
    if (sharpness > 0) {
      sharpenCanvas(working, sharpness / 120);
    }

    resultCanvas.width = working.width;
    resultCanvas.height = working.height;
    resultCanvas.getContext("2d").drawImage(working, 0, 0);
    state.cleanedDataUrl = resultCanvas.toDataURL("image/jpeg", 0.92);
    showResult();
    setStatus("Scan ready", "ready");
  });
}

function fullBounds(canvas) {
  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

function detectDocumentBounds(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const edge = Math.max(8, Math.round(Math.min(width, height) * 0.025));
  const samples = [];

  for (let y = 0; y < height; y += edge) {
    for (let x = 0; x < width; x += edge) {
      const i = (y * width + x) * 4;
      samples.push(luma(data[i], data[i + 1], data[i + 2]));
    }
  }

  samples.sort((a, b) => a - b);
  const background = samples[Math.floor(samples.length * 0.82)] || 235;
  const threshold = Math.max(16, background - 26);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const value = luma(data[i], data[i + 1], data[i + 2]);
      if (value < threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hits++;
      }
    }
  }

  if (hits < 50) return fullBounds(canvas);
  const pad = Math.round(Math.min(width, height) * 0.035);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad);
  maxY = Math.min(height, maxY + pad);

  if ((maxX - minX) * (maxY - minY) < width * height * 0.16) {
    return fullBounds(canvas);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function enhanceImage(imageData) {
  const data = imageData.data;
  const mode = modeSelect.value;
  const brightness = Number(controls.brightness.value);
  const contrast = 1 + Number(controls.contrast.value) / 55;
  const threshold = Number(controls.threshold.value) / 100;
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
  }

  const low = percentile(histogram, 0.04);
  const high = Math.max(low + 24, percentile(histogram, 0.96));
  const cutoff = low + (high - low) * threshold;

  for (let i = 0; i < data.length; i += 4) {
    const gray = normalize(luma(data[i], data[i + 1], data[i + 2]), low, high);
    const boosted = clamp((gray - 128) * contrast + 128 + brightness);

    if (mode === "mono") {
      const ink = boosted < cutoff ? 18 : 255;
      data[i] = ink;
      data[i + 1] = ink;
      data[i + 2] = ink;
    } else if (mode === "paper") {
      const paper = boosted > 210 ? 255 : boosted < cutoff ? boosted * 0.52 : boosted;
      data[i] = clamp(paper + 5);
      data[i + 1] = clamp(paper + 5);
      data[i + 2] = clamp(paper + 5);
    } else {
      const clean = boosted > 224 ? 255 : boosted;
      const mix = 0.28;
      data[i] = clamp(data[i] * (1 - mix) + clean * mix + brightness);
      data[i + 1] = clamp(data[i + 1] * (1 - mix) + clean * mix + brightness);
      data[i + 2] = clamp(data[i + 2] * (1 - mix) + clean * mix + brightness);
    }
  }
}

function sharpenCanvas(canvas, amount) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dst = ctx.createImageData(src.width, src.height);
  const s = src.data;
  const d = dst.data;
  const w = src.width;
  const h = src.height;
  const center = 1 + 4 * amount;
  const side = -amount;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const here = s[index + c] * center;
        const left = s[(y * w + Math.max(0, x - 1)) * 4 + c] * side;
        const right = s[(y * w + Math.min(w - 1, x + 1)) * 4 + c] * side;
        const up = s[(Math.max(0, y - 1) * w + x) * 4 + c] * side;
        const down = s[(Math.min(h - 1, y + 1) * w + x) * 4 + c] * side;
        d[index + c] = clamp(here + left + right + up + down);
      }
      d[index + 3] = s[index + 3];
    }
  }

  ctx.putImageData(dst, 0, 0);
}

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function normalize(value, low, high) {
  return clamp(((value - low) / (high - low)) * 255);
}

function percentile(histogram, target) {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  let running = 0;
  for (let i = 0; i < histogram.length; i++) {
    running += histogram[i];
    if (running >= total * target) return i;
  }
  return 255;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function showResult() {
  emptyState.classList.add("hidden");
  cameraPreview.classList.add("hidden");
  resultCanvas.classList.remove("hidden");
  pdfButton.disabled = false;
  imageButton.disabled = false;
  resetButton.disabled = false;
}

function resetScan() {
  stopCamera();
  state.sourceCanvas.width = 0;
  state.sourceCanvas.height = 0;
  state.cleanedDataUrl = "";
  fileInput.value = "";
  resultCanvas.classList.add("hidden");
  emptyState.classList.remove("hidden");
  pdfButton.disabled = true;
  imageButton.disabled = true;
  resetButton.disabled = true;
  setStatus("Ready", "idle");
}

function setStatus(message, kind) {
  statusText.textContent = message;
  statusDot.className = `status-dot ${kind}`;
}

async function downloadPdf() {
  const pdfBytes = createPdfFromJpeg(state.cleanedDataUrl, resultCanvas.width, resultCanvas.height);
  const fileName = `${state.fileName}.pdf`;
  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  if (typeof File !== "undefined") {
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "ClearScanR PDF Maker.com"
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
  }

  downloadBlob(blob, fileName);
}

function showInstallFallback() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const mobile = window.matchMedia("(max-width: 760px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!mobile || standalone) return;

  window.setTimeout(() => {
    if (!installPrompt) {
      installButton.classList.remove("hidden");
    }
  }, 1600);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      setStatus("Offline unavailable", "error");
    });
  });
}

function createPdfFromJpeg(dataUrl, imageWidth, imageHeight) {
  const imageBytes = base64ToUint8(dataUrl.split(",")[1]);
  const portrait = imageHeight >= imageWidth;
  const pageWidth = portrait ? 595.28 : 841.89;
  const pageHeight = portrait ? 841.89 : 595.28;
  const margin = 24;
  const scale = Math.min((pageWidth - margin * 2) / imageWidth, (pageHeight - margin * 2) / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = (pageWidth - drawWidth) / 2;
  const drawY = (pageHeight - drawHeight) / 2;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    streamObject(`q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ\n`),
    imageObject(imageBytes, imageWidth, imageHeight)
  ];

  return buildPdf(objects);
}

function streamObject(contents) {
  return {
    header: `<< /Length ${contents.length} >>`,
    stream: asciiBytes(contents)
  };
}

function imageObject(bytes, width, height) {
  return {
    header: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`,
    stream: bytes
  };
}

function buildPdf(objects) {
  const chunks = [asciiBytes("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(length);
    const prefix = asciiBytes(`${index + 1} 0 obj\n`);
    chunks.push(prefix);
    length += prefix.length;

    if (typeof object === "string") {
      const body = asciiBytes(`${object}\nendobj\n`);
      chunks.push(body);
      length += body.length;
    } else {
      const header = asciiBytes(`${object.header}\nstream\n`);
      const footer = asciiBytes("\nendstream\nendobj\n");
      chunks.push(header, object.stream, footer);
      length += header.length + object.stream.length + footer.length;
    }
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const xrefBytes = asciiBytes(xref);
  chunks.push(xrefBytes);
  length += xrefBytes.length;

  const pdf = new Uint8Array(length);
  let position = 0;
  chunks.forEach((chunk) => {
    pdf.set(chunk, position);
    position += chunk.length;
  });
  return pdf;
}

function asciiBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  return new Blob([base64ToUint8(data)], { type: mime });
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}
