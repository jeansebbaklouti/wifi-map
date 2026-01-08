const { exec } = require("child_process");

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 4000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        error,
      });
    });
  });
}

function parseWdutilChannelInfo(channelLine) {
  if (!channelLine) return { band: null, channel: null, width: null };
  const bandMatch = /(2g|5g|6g|2ghz|5ghz|6ghz)/i.exec(channelLine);
  const channelMatch = /(\d{1,3})/.exec(channelLine);
  const widthMatch =
    /(\d{2,3})\s*mhz/i.exec(channelLine) ||
    /\/(\d{1,3})/.exec(channelLine);
  const channel = channelMatch ? Number(channelMatch[1]) : null;
  const width = widthMatch ? Number(widthMatch[1]) : null;
  let band = null;
  if (bandMatch) {
    const token = bandMatch[1].toLowerCase();
    if (token.startsWith("2")) band = "2.4";
    if (token.startsWith("5")) band = "5";
    if (token.startsWith("6")) band = "6";
  }
  return { band, channel, width: Number.isFinite(width) ? width : null };
}

function parseWdutilInfo(output) {
  const ssid = /\n\s*SSID\s*:\s*(.+)/.exec(output)?.[1]?.trim() || null;
  const bssid = /\n\s*BSSID\s*:\s*([0-9a-f:]+)/i.exec(output)?.[1] || null;
  const rssiRaw = /\n\s*RSSI\s*:\s*(-?\d+)/.exec(output)?.[1];
  const noiseRaw = /\n\s*Noise\s*:\s*(-?\d+)/.exec(output)?.[1];
  const signalNoiseRaw = /\n\s*Signal\s*\/\s*Noise\s*:\s*(-?\d+)\s*dBm\s*\/\s*(-?\d+)/i.exec(
    output
  );
  const channelLine = /\n\s*Channel\s*:\s*([^\n]+)/.exec(output)?.[1]?.trim();
  const rssi = rssiRaw ? Number(rssiRaw) : signalNoiseRaw ? Number(signalNoiseRaw[1]) : null;
  const noise = noiseRaw ? Number(noiseRaw) : signalNoiseRaw ? Number(signalNoiseRaw[2]) : null;
  const channelInfo = parseWdutilChannelInfo(channelLine || "");
  return {
    ssid,
    bssid,
    rssi_dbm: Number.isFinite(rssi) ? rssi : null,
    noise_dbm: Number.isFinite(noise) ? noise : null,
    band: channelInfo.band,
    channel: channelInfo.channel,
    channel_width_mhz: channelInfo.width,
  };
}

async function run() {
  const result = await execCommand("sudo wdutil info");
  if (!result.stdout) {
    console.error(result.error?.message || "No output from wdutil.");
    process.exit(1);
  }
  console.log(JSON.stringify(parseWdutilInfo(result.stdout), null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
