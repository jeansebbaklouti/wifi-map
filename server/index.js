const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const { getScan } = require("./scan");
const { computeCongestion } = require("./channels");

const PORT = process.env.PORT || 8787;
const MODE = process.env.MODE || "heatmap";
const WIFI_IFACE = process.env.WIFI_IFACE || "wlan0";
const DATA_DIR = path.join(__dirname, "data");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");
const LEGACY_SAMPLES_PATH = path.join(__dirname, "samples.json");
const LEGACY_FLOORPLAN_PATH = path.join(__dirname, "floorplan.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

async function ensureProjects() {
  await ensureDataDir();
  try {
    await fs.access(PROJECTS_PATH);
  } catch {
    const initial = [{ id: "default", name: "Default" }];
    await fs.writeFile(PROJECTS_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
  await migrateLegacyData();
}

function slugifyProject(name) {
  if (!name) return "default";
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "default";
}

async function readProjects() {
  await ensureProjects();
  const raw = await fs.readFile(PROJECTS_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeProjects(projects) {
  await fs.writeFile(PROJECTS_PATH, JSON.stringify(projects, null, 2), "utf8");
}

function samplesPathFor(projectId) {
  return path.join(DATA_DIR, `samples-${projectId}.json`);
}

function floorplanPathFor(projectId) {
  return path.join(DATA_DIR, `floorplan-${projectId}.json`);
}

async function ensureProjectStorage(projectId) {
  await ensureDataDir();
  const samplesPath = samplesPathFor(projectId);
  const floorplanPath = floorplanPathFor(projectId);
  try {
    await fs.access(samplesPath);
  } catch {
    await fs.writeFile(samplesPath, "[]", "utf8");
  }
  try {
    await fs.access(floorplanPath);
  } catch {
    await fs.writeFile(
      floorplanPath,
      JSON.stringify({ dataUrl: null }, null, 2),
      "utf8"
    );
  }
}

async function getProjectId(requestedId) {
  const projects = await readProjects();
  if (!requestedId) {
    return projects[0]?.id || "default";
  }
  const match = projects.find((project) => project.id === requestedId);
  return match ? match.id : projects[0]?.id || "default";
}

async function readSamples(projectId) {
  await ensureProjectStorage(projectId);
  const raw = await fs.readFile(samplesPathFor(projectId), "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSamples(projectId, samples) {
  await fs.writeFile(
    samplesPathFor(projectId),
    JSON.stringify(samples, null, 2),
    "utf8"
  );
}

async function readFloorplan(projectId) {
  await ensureProjectStorage(projectId);
  const raw = await fs.readFile(floorplanPathFor(projectId), "utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed?.dataUrl || null;
  } catch {
    return null;
  }
}

async function writeFloorplan(projectId, dataUrl) {
  await fs.writeFile(
    floorplanPathFor(projectId),
    JSON.stringify({ dataUrl }, null, 2),
    "utf8"
  );
}

async function migrateLegacyData() {
  const projectId = "default";
  await ensureProjectStorage(projectId);
  try {
    await fs.access(LEGACY_SAMPLES_PATH);
    const existing = await readSamples(projectId);
    if (!existing.length) {
      const raw = await fs.readFile(LEGACY_SAMPLES_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        await writeSamples(projectId, parsed);
      }
    }
  } catch {}

  try {
    await fs.access(LEGACY_FLOORPLAN_PATH);
    const current = await readFloorplan(projectId);
    if (!current) {
      const raw = await fs.readFile(LEGACY_FLOORPLAN_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.dataUrl) {
        await writeFloorplan(projectId, parsed.dataUrl);
      }
    }
  } catch {}
}

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 2000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        error,
      });
    });
  });
}

function parseBandFromFreq(freq) {
  if (!freq) return null;
  if (freq >= 2400 && freq <= 2500) return "2.4";
  if (freq >= 4900 && freq <= 5900) return "5";
  return null;
}

function parseBandFromChannel(channel) {
  if (!channel) return null;
  const channelNum = Number(String(channel).split(",")[0]);
  if (Number.isNaN(channelNum)) return null;
  if (channelNum >= 1 && channelNum <= 14) return "2.4";
  return "5";
}

function parseMacAirport(output) {
  const ssid = /\n\s*SSID: (.+)/.exec(output)?.[1]?.trim() || null;
  const rssiRaw = /\n\s*agrCtlRSSI: (-?\d+)/.exec(output)?.[1];
  const channel = /\n\s*channel: ([\d,]+)/.exec(output)?.[1];
  const rssi = rssiRaw ? Number(rssiRaw) : null;
  return {
    ssid,
    rssi,
    band: parseBandFromChannel(channel),
  };
}

function parseBandFromWdutilChannel(channel) {
  if (!channel) return null;
  const match = /^\s*(2g|5g|6g)/i.exec(channel);
  if (!match) return null;
  const bandToken = match[1].toLowerCase();
  if (bandToken === "2g") return "2.4";
  if (bandToken === "5g") return "5";
  return "6";
}

function parseMacWdutil(output) {
  const ssid = /\n\s*SSID\s*:\s*(.+)/.exec(output)?.[1]?.trim() || null;
  const rssiRaw = /\n\s*RSSI\s*:\s*(-?\d+)/.exec(output)?.[1];
  const channel = /\n\s*Channel\s*:\s*([^\n]+)/.exec(output)?.[1]?.trim();
  const rssi = rssiRaw ? Number(rssiRaw) : null;
  return {
    ssid,
    rssi,
    band: parseBandFromWdutilChannel(channel),
  };
}

function parseLinuxIw(output) {
  const ssid = /SSID: (.+)/.exec(output)?.[1]?.trim() || null;
  const rssiRaw = /signal: (-?\d+)/.exec(output)?.[1];
  const freqRaw = /freq: (\d+)/.exec(output)?.[1];
  const rssi = rssiRaw ? Number(rssiRaw) : null;
  const freq = freqRaw ? Number(freqRaw) : null;
  return {
    ssid,
    rssi,
    band: parseBandFromFreq(freq),
  };
}

function parseWindowsNetsh(output) {
  const ssid = /\n\s*SSID\s*:\s*(.+)/.exec(output)?.[1]?.trim() || null;
  const signalRaw = /\n\s*Signal\s*:\s*(\d+)%/.exec(output)?.[1];
  const signalPct = signalRaw ? Number(signalRaw) : null;
  const rssi = signalPct === null ? null : Math.round(signalPct / 2 - 100);
  return {
    ssid,
    rssi,
    band: null,
  };
}

async function getWifiInfo() {
  const platform = process.platform;
  if (platform === "darwin") {
    
    const wdutil = await execCommand("sudo wdutil info");
    if (!wdutil.stdout && wdutil.error) {
      console.warn("wifi-heatmap: wdutil info failed", wdutil.error.message);
    }
    return parseMacWdutil(wdutil.stdout);
  }

  if (platform === "linux") {
    let iface = WIFI_IFACE;
    let { stdout } = await execCommand(`iw dev ${iface} link`);
    if (!stdout) {
      const probe = await execCommand("iw dev");
      const match = /Interface\s+(\S+)/.exec(probe.stdout);
      if (match?.[1]) {
        iface = match[1];
        ({ stdout } = await execCommand(`iw dev ${iface} link`));
      }
    }
    return parseLinuxIw(stdout);
  }

  if (platform === "win32") {
    const { stdout } = await execCommand("netsh wlan show interfaces");
    return parseWindowsNetsh(stdout);
  }

  return { ssid: null, rssi: null, band: null };
}

app.get("/api/meta", async (req, res) => {
  const info = await getWifiInfo();
  res.json({
    ssid: info.ssid,
    band: info.band,
    rssi: info.rssi,
    mode: MODE,
  });
});

app.get("/api/scan", async (req, res) => {
  if (process.platform !== "darwin") {
    res.status(501).json({ error: "macOS only" });
    return;
  }
  const force = req.query.force === "1";
  const scan = await getScan({ force });
  res.json(scan);
});

app.get("/api/channels", async (req, res) => {
  if (process.platform !== "darwin") {
    res.status(501).json({ error: "macOS only" });
    return;
  }
  const force = req.query.force === "1";
  const scan = await getScan({ force });
  const report = computeCongestion(scan.networks);
  res.json({
    t: scan.t,
    source: scan.source,
    cache_hit: scan.cache_hit,
    ...report,
  });
});

app.get("/api/projects", async (req, res) => {
  const projects = await readProjects();
  res.json(projects);
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const projects = await readProjects();
  const idBase = slugifyProject(name);
  let id = idBase;
  let counter = 2;
  while (projects.some((project) => project.id === id)) {
    id = `${idBase}-${counter}`;
    counter += 1;
  }
  const project = { id, name: name.trim() };
  projects.push(project);
  await writeProjects(projects);
  await ensureProjectStorage(id);
  res.json(project);
});

app.get("/api/samples", async (req, res) => {
  const projectId = await getProjectId(req.query.project);
  const samples = await readSamples(projectId);
  res.json(samples);
});

app.get("/api/floorplan", async (req, res) => {
  const projectId = await getProjectId(req.query.project);
  const dataUrl = await readFloorplan(projectId);
  res.json({ dataUrl });
});

app.post("/api/floorplan", async (req, res) => {
  const { dataUrl, project } = req.body || {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* URL" });
    return;
  }
  const projectId = await getProjectId(project);
  await writeFloorplan(projectId, dataUrl);
  res.json({ ok: true });
});

app.post("/api/sample", async (req, res) => {
  const { x, y, project } = req.body || {};
  if (typeof x !== "number" || typeof y !== "number") {
    res.status(400).json({ error: "x and y are required numbers" });
    return;
  }
  const projectId = await getProjectId(project);
  const info = await getWifiInfo();
  const samples = await readSamples(projectId);
  const sample = {
    id: Date.now(),
    x,
    y,
    rssi: info.rssi,
    band: info.band,
    ssid: info.ssid,
    createdAt: new Date().toISOString(),
  };
  samples.push(sample);
  await writeSamples(projectId, samples);
  res.json(sample);
});

app.post("/api/reset", async (req, res) => {
  const projectId = await getProjectId(req.body?.project || req.query.project);
  await writeSamples(projectId, []);
  res.json({ ok: true });
});

app.listen(PORT, async () => {
  await ensureProjects();
  console.log(`wifi-heatmap API running on http://localhost:${PORT}`);
});
