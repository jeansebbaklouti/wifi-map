const { exec } = require("child_process");

const CACHE_TTL_MS = 45000;
let cache = null;

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 12000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        error,
      });
    });
  });
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseChannelInfo(text) {
  if (!text) return { channel: null, width: null };
  const channelMatch = /(\d{1,3})/.exec(text);
  const widthMatch = /(\d{2,3})\s*MHz/i.exec(text) || /\/(\d{1,3})/.exec(text);
  const channel = channelMatch ? toNumber(channelMatch[1]) : null;
  const width = widthMatch ? toNumber(widthMatch[1]) : null;
  return { channel, width };
}

function normalizeNetwork(network) {
  const channel = toNumber(network.channel);
  return {
    ssid: network.ssid || null,
    bssid: network.bssid || null,
    rssi_dbm: toNumber(network.rssi_dbm),
    channel,
    channel_width_mhz: toNumber(network.channel_width_mhz),
    band: channel ? (channel <= 14 ? "2.4" : "5") : null,
  };
}

function parseWdutilScan(output) {
  if (!output) return [];
  const blocks = output.split(/\n\s*\n/);
  const networks = [];

  for (const block of blocks) {
    const ssid = /SSID\s*:\s*(.+)/i.exec(block)?.[1]?.trim() || null;
    const bssid = /BSSID\s*:\s*([0-9a-fA-F:]+)/i.exec(block)?.[1] || null;
    const rssiRaw =
      /RSSI\s*:\s*(-?\d+)/i.exec(block)?.[1] ||
      /Signal\s*:\s*(-?\d+)/i.exec(block)?.[1];
    const channelLine =
      /Channel\s*:\s*([^\n]+)/i.exec(block)?.[1] ||
      /Channel\s*:\s*(\d+)/i.exec(block)?.[1] ||
      null;
    const widthLine =
      /Channel Width\s*:\s*([^\n]+)/i.exec(block)?.[1] ||
      /Width\s*:\s*([^\n]+)/i.exec(block)?.[1] ||
      null;
    if (!ssid && !bssid && !rssiRaw && !channelLine) {
      continue;
    }
    const channelInfo = parseChannelInfo(channelLine || "");
    const widthInfo = parseChannelInfo(widthLine || "");
    networks.push(
      normalizeNetwork({
        ssid,
        bssid,
        rssi_dbm: rssiRaw,
        channel: channelInfo.channel,
        channel_width_mhz: widthInfo.width || channelInfo.width,
      })
    );
  }

  if (networks.length) {
    return networks;
  }

  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /ssid/i.test(line) && /channel/i.test(line));
  if (headerIndex === -1) return [];

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const ssid = parts[0] || null;
    const bssid = parts.find((part) => /([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(part)) || null;
    const rssiRaw = parts.find((part) => /^-?\d+$/.test(part)) || null;
    const channelPart = parts.find((part) => /(\d{1,3})(\/\d+)?/.test(part)) || null;
    const channelInfo = parseChannelInfo(channelPart || "");
    networks.push(
      normalizeNetwork({
        ssid,
        bssid,
        rssi_dbm: rssiRaw,
        channel: channelInfo.channel,
        channel_width_mhz: channelInfo.width,
      })
    );
  }

  return networks;
}

function parseSystemProfiler(output) {
  if (!output) return [];
  const lines = output.split("\n");
  const sectionIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes("other local") && normalized.includes("networks");
  });
  if (sectionIndex === -1) return [];
  const sectionLines = lines.slice(sectionIndex + 1);
  const networks = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    networks.push(normalizeNetwork(current));
    current = null;
  };

  for (const line of sectionLines) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      break;
    }
    const nameMatch = /^\s{4,}(.+):\s*$/.exec(line);
    if (nameMatch) {
      pushCurrent();
      const name = nameMatch[1].trim();
      if (/^current network information$/i.test(name)) {
        current = null;
        continue;
      }
      if (/^awdl/i.test(name)) {
        current = null;
        continue;
      }
      current = { ssid: name };
      continue;
    }
    const kvMatch = /^\s{6,}([^:]+):\s*(.+)$/.exec(line);
    if (!kvMatch || !current) continue;
    const key = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2].trim();
    if (key === "channel") {
      const { channel, width } = parseChannelInfo(value);
      current.channel = channel;
      current.channel_width_mhz = width;
    } else if (key === "rssi" || key === "signal" || key.includes("signal")) {
      current.rssi_dbm = /-?\d+/.exec(value)?.[0] || null;
    } else if (key === "bssid") {
      current.bssid = value;
    }
  }
  pushCurrent();
  return networks;
}

async function supportsWdutilScan() {
  const help = await execCommand("wdutil help");
  if (!help.stdout) return false;
  return /scan/i.test(help.stdout);
}

async function runScan() {
  const t = Date.now();
  if (process.platform !== "darwin") {
    return { t, networks: [], source: "system_profiler" };
  }

  const hasScan = await supportsWdutilScan();
  if (hasScan) {
    const wdutil = await execCommand("wdutil scan");
    const networks = parseWdutilScan(wdutil.stdout);
    if (networks.length) {
      return { t, networks, source: "wdutil" };
    }
  }

  const profiler = await execCommand("system_profiler SPAirPortDataType");
  const networks = parseSystemProfiler(profiler.stdout);
  return { t, networks, source: "system_profiler" };
}

async function getScan(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && cache && now - cache.t < CACHE_TTL_MS) {
    return { ...cache, cache_hit: true };
  }
  const scan = await runScan();
  cache = {
    t: scan.t,
    networks: scan.networks,
    source: scan.source,
  };
  return { ...cache, cache_hit: false };
}

module.exports = {
  getScan,
  runScan,
  parseWdutilScan,
  parseSystemProfiler,
};
