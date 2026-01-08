const { exec } = require("child_process");

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

function parsePingOutput(output) {
  if (!output) {
    console.warn(
      "[parsePingOutput] No ping output provided, returning null metrics"
    );
    return {
      loss_pct: null,
      avg_ms: null,
      min_ms: null,
      max_ms: null,
      jitter_ms: null,
    };
  }
  const lossMatch = /(\d+(?:\.\d+)?)%\s*packet loss/.exec(output);
  const rttMatch =
    /round-trip.*?=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/.exec(output) ||
    /rtt.*?=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/.exec(output);
  const loss = lossMatch ? Number(lossMatch[1]) : null;
  const min = rttMatch ? Number(rttMatch[1]) : null;
  const avg = rttMatch ? Number(rttMatch[2]) : null;
  const max = rttMatch ? Number(rttMatch[3]) : null;
  const jitter =
    Number.isFinite(min) && Number.isFinite(max)
      ? Number((max - min).toFixed(1))
      : null;

  // Validate parsing results and log warnings if critical fields are missing
  const lossValid = Number.isFinite(loss);
  const rttValid = Number.isFinite(avg);

  if (!lossValid && !rttValid) {
    console.error(
      "[parsePingOutput] Failed to parse both packet loss and RTT metrics. " +
        "This may indicate an unexpected ping output format."
    );
  } else if (!lossValid) {
    console.warn(
      "[parsePingOutput] Failed to parse packet loss. Output may not match expected format."
    );
  } else if (!rttValid) {
    console.warn(
      "[parsePingOutput] Failed to parse RTT metrics (min/avg/max). Output may not match expected format."
    );
  }

  return {
    loss_pct: lossValid ? loss : null,
    avg_ms: Number.isFinite(avg) ? Number(avg.toFixed(1)) : null,
    min_ms: Number.isFinite(min) ? Number(min.toFixed(1)) : null,
    max_ms: Number.isFinite(max) ? Number(max.toFixed(1)) : null,
    jitter_ms: jitter,
  };
}

async function getGatewayIp() {
  const route = await execCommand("route -n get default");
  const gateway =
    /gateway:\s+([0-9.]+)/.exec(route.stdout)?.[1] ||
    /gateway:\s+([0-9.]+)/.exec(route.stderr)?.[1] ||
    null;
  if (gateway) return gateway;

  const netstat = await execCommand("netstat -rn");
  const line = netstat.stdout
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith("default") || row.startsWith("0.0.0.0"));
  if (!line) return null;
  const parts = line.split(/\s+/);
  return parts[1] || null;
}

async function run() {
  const gateway = await getGatewayIp();
  if (!gateway) {
    console.log(JSON.stringify({ gateway: null }, null, 2));
    return;
  }
  const ping = await execCommand(`ping -c 8 -W 1000 ${gateway}`);
  const stats = parsePingOutput(ping.stdout || ping.stderr || "");
  console.log(JSON.stringify({ gateway, ...stats }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
