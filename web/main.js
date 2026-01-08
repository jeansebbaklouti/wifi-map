const API_BASE = "http://localhost:8787";
const metaEl = document.getElementById("meta");
const bandFilterEl = document.getElementById("bandFilter");
const resetEl = document.getElementById("reset");
const togglePointsEl = document.getElementById("togglePoints");
const projectSelectEl = document.getElementById("projectSelect");
const newProjectEl = document.getElementById("newProject");
const floorplanInput = document.getElementById("floorplan");
const floorplanImage = document.getElementById("floorplanImage");
const heatmapCanvas = document.getElementById("heatmapCanvas");
const heatmapCtx = heatmapCanvas.getContext("2d");
const heatmapBuffer = document.createElement("canvas");
const heatmapBufferCtx = heatmapBuffer.getContext("2d");
const heatmapBlur = document.createElement("canvas");
const heatmapBlurCtx = heatmapBlur.getContext("2d");
const pointsCanvas = document.getElementById("pointsCanvas");
const pointsCtx = pointsCanvas.getContext("2d");
const tooltipEl = document.getElementById("sampleTooltip");
const spectrumCanvas = document.getElementById("spectrumCanvas");
const spectrumCtx = spectrumCanvas.getContext("2d");
const spectrumTab = document.getElementById("spectrumTab");
const channelsTab = document.getElementById("channelsTab");
const scanNowEl = document.getElementById("scanNow");
const scanMetaEl = document.getElementById("scanMeta");
const reco24El = document.getElementById("reco24");
const reco5El = document.getElementById("reco5");
const scores24El = document.getElementById("scores24");
const scores5El = document.getElementById("scores5");
const list24El = document.getElementById("list24");
const list5El = document.getElementById("list5");

let samples = [];
let spectrumTimer = null;
const spectrumPoints = [];
const spectrumMaxPoints = 120;
const heatmapPalette = buildHeatmapPalette();
const heatmapBlurRadius = 24;
const heatmapGridStep = 24;
const heatmapIdwPower = 2;
const heatmapMaxDistance = 220;
const heatmapContrast = 1.5;
let showPoints = false;
let currentProjectId = "default";
let latestScan = null;

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
  try {
    const res = await fetch(`${API_BASE}/api/meta`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const info = await res.json();
    setMetaText(info);
    if (info.mode === "spectrum") {
      spectrumTab.hidden = false;
    }
    return info;
  } catch (error) {
    console.warn("Failed to fetch Wi-Fi metadata.", error);
    setMetaText({ ssid: null, band: null, rssi: null, mode: "heatmap" });
    return null;
  }
}

async function fetchScan(force = false) {
  const url = force ? `${API_BASE}/api/scan?force=1` : `${API_BASE}/api/scan`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchChannels(force = false) {
  const url = force ? `${API_BASE}/api/channels?force=1` : `${API_BASE}/api/channels`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchSamples() {
  const res = await fetch(`${API_BASE}/api/samples?project=${encodeURIComponent(currentProjectId)}`);
  samples = await res.json();
}

async function fetchFloorplan() {
  const res = await fetch(`${API_BASE}/api/floorplan?project=${encodeURIComponent(currentProjectId)}`);
  if (!res.ok) return;
  const { dataUrl } = await res.json();
  if (dataUrl) {
    floorplanImage.src = dataUrl;
  } else {
    floorplanImage.removeAttribute("src");
  }
}

async function saveFloorplan(dataUrl) {
  await fetch(`${API_BASE}/api/floorplan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, project: currentProjectId }),
  });
}

function resizeCanvasToImage() {
  if (!floorplanImage.src) return;
  heatmapCanvas.width = floorplanImage.naturalWidth;
  heatmapCanvas.height = floorplanImage.naturalHeight;
  heatmapCanvas.style.width = `${floorplanImage.naturalWidth}px`;
  heatmapCanvas.style.height = `${floorplanImage.naturalHeight}px`;
  heatmapBuffer.width = floorplanImage.naturalWidth;
  heatmapBuffer.height = floorplanImage.naturalHeight;
  heatmapBlur.width = floorplanImage.naturalWidth;
  heatmapBlur.height = floorplanImage.naturalHeight;
  pointsCanvas.width = floorplanImage.naturalWidth;
  pointsCanvas.height = floorplanImage.naturalHeight;
  pointsCanvas.style.width = `${floorplanImage.naturalWidth}px`;
  pointsCanvas.style.height = `${floorplanImage.naturalHeight}px`;
}

function normalizeRssi(rssi) {
  if (typeof rssi !== "number") return 0;
  const clamped = Math.max(-90, Math.min(-30, rssi));
  const t = (clamped + 90) / 60;
  return Math.pow(t, heatmapContrast);
}

function buildHeatmapPalette() {
  const paletteCanvas = document.createElement("canvas");
  paletteCanvas.width = 256;
  paletteCanvas.height = 1;
  const ctx = paletteCanvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, "#1e3a8a");
  gradient.addColorStop(0.25, "#2563eb");
  gradient.addColorStop(0.5, "#22c55e");
  gradient.addColorStop(0.75, "#f59e0b");
  gradient.addColorStop(1, "#ef4444");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

function getFilteredSamples() {
  const bandFilter = bandFilterEl.value;
  return samples.filter((sample) => {
    if (bandFilter === "all") return true;
    return sample.band === bandFilter;
  });
}

function colorFromIntensity(intensity, alpha = 0.9) {
  const idx = Math.min(255, Math.max(0, Math.round(intensity * 255)));
  const r = heatmapPalette[idx * 4];
  const g = heatmapPalette[idx * 4 + 1];
  const b = heatmapPalette[idx * 4 + 2];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorizeHeatmap() {
  const imageData = heatmapBlurCtx.getImageData(
    0,
    0,
    heatmapBlur.width,
    heatmapBlur.height
  );
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const idx = Math.min(255, alpha);
    data[i] = heatmapPalette[idx * 4];
    data[i + 1] = heatmapPalette[idx * 4 + 1];
    data[i + 2] = heatmapPalette[idx * 4 + 2];
    data[i + 3] = Math.min(220, alpha);
  }
  heatmapCtx.putImageData(imageData, 0, 0);
}

function drawPoints(points) {
  pointsCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);
  if (!showPoints) return;
  points.forEach((sample) => {
    const intensity = normalizeRssi(sample.rssi);
    const color = intensity ? colorFromIntensity(intensity, 0.85) : "rgba(107,114,128,0.7)";
    pointsCtx.beginPath();
    pointsCtx.fillStyle = color;
    pointsCtx.arc(sample.x, sample.y, 5, 0, Math.PI * 2);
    pointsCtx.fill();
    pointsCtx.lineWidth = 1;
    pointsCtx.strokeStyle = "rgba(255,255,255,0.9)";
    pointsCtx.stroke();
  });
}

function setTooltip(sample, x, y) {
  if (!sample) {
    tooltipEl.hidden = true;
    return;
  }
  const ssid = sample.ssid || "unknown";
  const band = sample.band ? `${sample.band} GHz` : "unknown";
  const rssi = typeof sample.rssi === "number" ? `${sample.rssi} dBm` : "unknown";
  tooltipEl.textContent = `${ssid} | ${band} | ${rssi}`;
  tooltipEl.style.left = `${x + 12}px`;
  tooltipEl.style.top = `${y + 12}px`;
  tooltipEl.hidden = false;
}

function findClosestSample(x, y, points) {
  let closest = null;
  let closestDist = Infinity;
  for (const sample of points) {
    const dx = sample.x - x;
    const dy = sample.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = sample;
    }
  }
  return closestDist <= 10 ? closest : null;
}

function estimateRssiAt(x, y, points) {
  let weightSum = 0;
  let valueSum = 0;
  const maxDistSq = heatmapMaxDistance * heatmapMaxDistance;
  for (const point of points) {
    const dx = point.x - x;
    const dy = point.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxDistSq) continue;
    const dist = Math.sqrt(distSq) || 1;
    const weight = 1 / Math.pow(dist, heatmapIdwPower);
    weightSum += weight;
    valueSum += weight * point.rssi;
  }
  if (!weightSum) return null;
  return valueSum / weightSum;
}

function drawHeatmap() {
  heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  heatmapBufferCtx.clearRect(0, 0, heatmapBuffer.width, heatmapBuffer.height);
  heatmapBlurCtx.clearRect(0, 0, heatmapBlur.width, heatmapBlur.height);
  const filtered = getFilteredSamples();
  const points = filtered.filter((sample) => typeof sample.rssi === "number");
  if (!points.length) return;
  for (let y = 0; y <= heatmapBuffer.height; y += heatmapGridStep) {
    for (let x = 0; x <= heatmapBuffer.width; x += heatmapGridStep) {
      const rssi = estimateRssiAt(x, y, points);
      if (rssi === null) continue;
      const intensity = normalizeRssi(rssi);
      if (!intensity) continue;
      const radius = heatmapGridStep * 1.2;
      const gradient = heatmapBufferCtx.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        radius
      );
      gradient.addColorStop(0, `rgba(0, 0, 0, ${0.08 + intensity * 0.5})`);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      heatmapBufferCtx.fillStyle = gradient;
      heatmapBufferCtx.beginPath();
      heatmapBufferCtx.arc(x, y, radius, 0, Math.PI * 2);
      heatmapBufferCtx.fill();
    }
  }
  heatmapBlurCtx.filter = `blur(${heatmapBlurRadius}px)`;
  heatmapBlurCtx.drawImage(heatmapBuffer, 0, 0);
  heatmapBlurCtx.filter = "none";
  colorizeHeatmap();
  drawPoints(filtered);
}

async function addSampleAt(x, y) {
  await fetch(`${API_BASE}/api/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, project: currentProjectId }),
  });
  await fetchSamples();
  drawHeatmap();
}

async function resetSamples() {
  await fetch(`${API_BASE}/api/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: currentProjectId }),
  });
  samples = [];
  drawHeatmap();
}

function setupFloorplanUpload() {
  floorplanInput.addEventListener("change", () => {
    const file = floorplanInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      floorplanImage.src = dataUrl;
      if (typeof dataUrl === "string") {
        await saveFloorplan(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  });

  floorplanImage.addEventListener("load", () => {
    resizeCanvasToImage();
    drawHeatmap();
  });
}

function setupHeatmapClick() {
  pointsCanvas.addEventListener("click", async (event) => {
    const rect = pointsCanvas.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (pointsCanvas.width / rect.width));
    const y = Math.round((event.clientY - rect.top) * (pointsCanvas.height / rect.height));
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

      if (button.dataset.tab === "channels") {
        refreshChannels(false);
      }
    });
  });
}

function renderScoreBars(container, scores) {
  container.innerHTML = "";
  const entries = Object.entries(scores).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!entries.length) {
    container.innerHTML = "<span class=\"hint\">No data yet.</span>";
    return;
  }
  const max = Math.max(...entries.map(([, value]) => value));
  entries.forEach(([channel, value]) => {
    const row = document.createElement("div");
    row.className = "score-row";
    const label = document.createElement("span");
    label.textContent = channel;
    const bar = document.createElement("div");
    bar.className = "score-bar";
    const fill = document.createElement("span");
    const pct = max ? Math.round((value / max) * 100) : 0;
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    const score = document.createElement("span");
    score.textContent = value.toFixed(2);
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(score);
    container.appendChild(row);
  });
}

function renderNetworkList(container, networks) {
  container.innerHTML = "";
  if (!networks.length) {
    container.innerHTML = "<li>No networks detected.</li>";
    return;
  }
  networks.slice(0, 6).forEach((network) => {
    const li = document.createElement("li");
    const ssid = network.ssid || "Hidden SSID";
    const channel = network.channel ?? "n/a";
    const rssi = typeof network.rssi_dbm === "number" ? `${network.rssi_dbm} dBm` : "n/a";
    li.textContent = `${ssid} • ch ${channel} • ${rssi}`;
    container.appendChild(li);
  });
}

function renderChannels(report) {
  if (!report) return;
  const reco24 = report.band24?.recommended;
  const reco5 = report.band5?.recommended;
  reco24El.textContent = reco24
    ? `Recommend channel ${reco24.channel} @ ${reco24.width_mhz} MHz — ${reco24.reason}`
    : "No recommendation yet.";
  reco5El.textContent = reco5
    ? `Recommend channel ${reco5.channel} @ ${reco5.width_mhz} MHz — ${reco5.reason}`
    : "No recommendation yet.";
  renderScoreBars(scores24El, report.band24?.scoresByChannel || {});
  renderScoreBars(scores5El, report.band5?.scoresByChannel || {});
  const networks = Array.isArray(latestScan?.networks) ? latestScan.networks : [];
  renderNetworkList(
    list24El,
    networks.filter((network) => network.band === "2.4")
  );
  renderNetworkList(
    list5El,
    networks.filter((network) => network.band === "5")
  );
}

async function refreshChannels(force) {
  const scan = await fetchScan(force);
  const report = await fetchChannels(false);
  if (scan) {
    latestScan = scan;
    const time = new Date(scan.t).toLocaleTimeString();
    scanMetaEl.textContent = `Last scan ${time} (${scan.source})${scan.cache_hit ? " • cached" : ""}`;
  } else {
    scanMetaEl.textContent = "Scan not available on this platform.";
  }
  renderChannels(report);
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

async function fetchProjects() {
  const res = await fetch(`${API_BASE}/api/projects`);
  return res.ok ? res.json() : [];
}

function renderProjects(projects) {
  projectSelectEl.innerHTML = "";
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelectEl.appendChild(option);
  });
}

async function createProject(name) {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function loadProject(projectId) {
  currentProjectId = projectId;
  localStorage.setItem("wifi-heatmap-project", projectId);
  await fetchFloorplan();
  await fetchSamples();
  drawHeatmap();
}

function setupPointToggle() {
  togglePointsEl.addEventListener("click", () => {
    showPoints = !showPoints;
    togglePointsEl.textContent = showPoints ? "Hide points" : "Show points";
    tooltipEl.hidden = true;
    drawHeatmap();
  });
}

function setupPointHover() {
  pointsCanvas.addEventListener("mousemove", (event) => {
    if (!showPoints) return;
    const rect = pointsCanvas.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (pointsCanvas.width / rect.width));
    const y = Math.round((event.clientY - rect.top) * (pointsCanvas.height / rect.height));
    const sample = findClosestSample(x, y, getFilteredSamples());
    setTooltip(sample, event.clientX - rect.left, event.clientY - rect.top);
  });
  pointsCanvas.addEventListener("mouseleave", () => {
    tooltipEl.hidden = true;
  });
}

async function init() {
  setupFloorplanUpload();
  setupHeatmapClick();
  setupTabs();
  setupPointToggle();
  setupPointHover();
  scanNowEl.addEventListener("click", async () => {
    await refreshChannels(true);
  });
  resetEl.addEventListener("click", resetSamples);
  bandFilterEl.addEventListener("change", drawHeatmap);
  const savedProject = localStorage.getItem("wifi-heatmap-project");
  const projects = await fetchProjects();
  renderProjects(projects);
  const initialProject =
    projects.find((project) => project.id === savedProject)?.id ||
    projects[0]?.id ||
    "default";
  projectSelectEl.value = initialProject;
  projectSelectEl.addEventListener("change", async () => {
    await loadProject(projectSelectEl.value);
  });
  newProjectEl.addEventListener("click", async () => {
    const name = window.prompt("New project name");
    if (!name) return;
    const created = await createProject(name);
    if (!created) return;
    const updated = await fetchProjects();
    renderProjects(updated);
    projectSelectEl.value = created.id;
    await loadProject(created.id);
  });
  await fetchMeta();
  await loadProject(initialProject);
}

init();
