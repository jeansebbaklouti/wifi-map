const API_BASE = "http://localhost:8787";
const metaEl = document.getElementById("meta");
const bandFilterEl = document.getElementById("bandFilter");
const resetEl = document.getElementById("reset");
const floorplanInput = document.getElementById("floorplan");
const floorplanImage = document.getElementById("floorplanImage");
const heatmapCanvas = document.getElementById("heatmapCanvas");
const heatmapCtx = heatmapCanvas.getContext("2d");
const spectrumCanvas = document.getElementById("spectrumCanvas");
const spectrumCtx = spectrumCanvas.getContext("2d");
const spectrumTab = document.getElementById("spectrumTab");

let samples = [];
let spectrumTimer = null;
const spectrumPoints = [];
const spectrumMaxPoints = 120;

function setMetaText(info) {
  if (!info) return;
  const parts = [
    info.ssid ? `SSID: ${info.ssid}` : "SSID: unknown",
    info.band ? `${info.band} GHz` : "Band: unknown",
    typeof info.rssi === "number" ? `RSSI: ${info.rssi} dBm` : "RSSI: unknown",
  ];
  metaEl.textContent = `${parts.join(" | ")} | mode: ${info.mode || "heatmap"}`;
}

async function fetchMeta() {
  const res = await fetch(`${API_BASE}/api/meta`);
  const info = await res.json();
  setMetaText(info);
  if (info.mode === "spectrum") {
    spectrumTab.hidden = false;
  }
  return info;
}

async function fetchSamples() {
  const res = await fetch(`${API_BASE}/api/samples`);
  samples = await res.json();
}

function resizeCanvasToImage() {
  if (!floorplanImage.src) return;
  heatmapCanvas.width = floorplanImage.naturalWidth;
  heatmapCanvas.height = floorplanImage.naturalHeight;
  heatmapCanvas.style.width = `${floorplanImage.naturalWidth}px`;
  heatmapCanvas.style.height = `${floorplanImage.naturalHeight}px`;
}

function rssiToColor(rssi) {
  if (typeof rssi !== "number") return "rgba(128,128,128,0.4)";
  const clamped = Math.max(-90, Math.min(-30, rssi));
  const t = (clamped + 90) / 60;
  const r = Math.round(255 * t);
  const b = Math.round(255 * (1 - t));
  return `rgba(${r}, 80, ${b}, 0.55)`;
}

function drawHeatmap() {
  heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  const bandFilter = bandFilterEl.value;
  const filtered = samples.filter((sample) => {
    if (bandFilter === "all") return true;
    return sample.band === bandFilter;
  });

  filtered.forEach((sample) => {
    const radius = 32;
    heatmapCtx.beginPath();
    heatmapCtx.fillStyle = rssiToColor(sample.rssi);
    heatmapCtx.arc(sample.x, sample.y, radius, 0, Math.PI * 2);
    heatmapCtx.fill();
  });
}

async function addSampleAt(x, y) {
  await fetch(`${API_BASE}/api/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y }),
  });
  await fetchSamples();
  drawHeatmap();
}

async function resetSamples() {
  await fetch(`${API_BASE}/api/reset`, { method: "POST" });
  samples = [];
  drawHeatmap();
}

function setupFloorplanUpload() {
  floorplanInput.addEventListener("change", () => {
    const file = floorplanInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      floorplanImage.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  floorplanImage.addEventListener("load", () => {
    resizeCanvasToImage();
    drawHeatmap();
  });
}

function setupHeatmapClick() {
  heatmapCanvas.addEventListener("click", async (event) => {
    const rect = heatmapCanvas.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (heatmapCanvas.width / rect.width));
    const y = Math.round((event.clientY - rect.top) * (heatmapCanvas.height / rect.height));
    await addSampleAt(x, y);
    await fetchMeta();
  });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      const panel = document.getElementById(button.dataset.tab);
      panel.classList.add("active");

      if (button.dataset.tab === "spectrum") {
        startSpectrum();
      } else {
        stopSpectrum();
      }
    });
  });
}

function drawSpectrum() {
  spectrumCtx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
  spectrumCtx.strokeStyle = "#4f46e5";
  spectrumCtx.lineWidth = 2;
  spectrumCtx.beginPath();

  const points = spectrumPoints.slice(-spectrumMaxPoints);
  points.forEach((point, idx) => {
    const x = (idx / (spectrumMaxPoints - 1)) * spectrumCanvas.width;
    const normalized = Math.max(-90, Math.min(-30, point));
    const y = spectrumCanvas.height - ((normalized + 90) / 60) * spectrumCanvas.height;
    if (idx === 0) {
      spectrumCtx.moveTo(x, y);
    } else {
      spectrumCtx.lineTo(x, y);
    }
  });
  spectrumCtx.stroke();
}

async function pollSpectrum() {
  const info = await fetchMeta();
  if (typeof info.rssi === "number") {
    spectrumPoints.push(info.rssi);
    if (spectrumPoints.length > spectrumMaxPoints) {
      spectrumPoints.shift();
    }
    drawSpectrum();
  }
}

function startSpectrum() {
  if (spectrumTimer) return;
  spectrumTimer = setInterval(pollSpectrum, 500);
}

function stopSpectrum() {
  if (spectrumTimer) {
    clearInterval(spectrumTimer);
    spectrumTimer = null;
  }
}

async function init() {
  setupFloorplanUpload();
  setupHeatmapClick();
  setupTabs();
  resetEl.addEventListener("click", resetSamples);
  bandFilterEl.addEventListener("change", drawHeatmap);
  await fetchMeta();
  await fetchSamples();
  drawHeatmap();
}

init();
