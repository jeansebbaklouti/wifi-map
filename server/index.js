const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");

const PORT = process.env.PORT || 8787;
const MODE = process.env.MODE || "heatmap";
const WIFI_IFACE = process.env.WIFI_IFACE || "wlan0";
const STORAGE_PATH = path.join(__dirname, "samples.json");

const app = express();
app.use(cors());
app.use(express.json());

async function ensureStorage() {
  try {
    await fs.access(STORAGE_PATH);
  } catch {
    await fs.writeFile(STORAGE_PATH, "[]", "utf8");
  }
}

async function readSamples() {
  await ensureStorage();
  const raw = await fs.readFile(STORAGE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSamples(samples) {
  await fs.writeFile(STORAGE_PATH, JSON.stringify(samples, null, 2), "utf8");
}

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(stdout || "");
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
    const output = await execCommand(
      "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I"
    );
    return parseMacAirport(output);
  }

  if (platform === "linux") {
    const output = await execCommand(`iw dev ${WIFI_IFACE} link`);
    return parseLinuxIw(output);
  }

  if (platform === "win32") {
    const output = await execCommand("netsh wlan show interfaces");
    return parseWindowsNetsh(output);
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

app.get("/api/samples", async (req, res) => {
  const samples = await readSamples();
  res.json(samples);
});

app.post("/api/sample", async (req, res) => {
  const { x, y } = req.body || {};
  if (typeof x !== "number" || typeof y !== "number") {
    res.status(400).json({ error: "x and y are required numbers" });
    return;
  }
  const info = await getWifiInfo();
  const samples = await readSamples();
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
  await writeSamples(samples);
  res.json(sample);
});

app.post("/api/reset", async (req, res) => {
  await writeSamples([]);
  res.json({ ok: true });
});

app.listen(PORT, async () => {
  await ensureStorage();
  console.log(`wifi-heatmap API running on http://localhost:${PORT}`);
});
