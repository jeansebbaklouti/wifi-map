const { exec } = require("child_process");

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { timeout: 3000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        error,
      });
    });
  });
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
  console.log(JSON.stringify({ gateway }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
