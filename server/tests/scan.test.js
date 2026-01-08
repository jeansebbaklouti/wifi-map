const assert = require("assert");
const { parseWdutilScan, parseSystemProfiler } = require("../scan");

const wdutilSample = `
SSID: OfficeWiFi
BSSID: aa:bb:cc:dd:ee:ff
RSSI: -55 dBm
Channel: 11/20

SSID: Guest
RSSI: -70 dBm
Channel: 36 (5 GHz, 80 MHz)
`;

const profilerSample = `
Other Local Wi-Fi Networks:
    OfficeWiFi:
      Channel: 11 (2.4 GHz, 20 MHz)
      RSSI: -63 dBm
      BSSID: aa:bb:cc:dd:ee:ff
    NeighborNet:
      Channel: 36 (5 GHz, 80 MHz)
      Signal: -72 dBm
`;

const wdNetworks = parseWdutilScan(wdutilSample);
assert.strictEqual(wdNetworks.length, 2);
assert.strictEqual(wdNetworks[0].ssid, "OfficeWiFi");
assert.strictEqual(wdNetworks[0].channel, 11);
assert.strictEqual(wdNetworks[0].band, "2.4");
assert.strictEqual(wdNetworks[1].channel, 36);
assert.strictEqual(wdNetworks[1].band, "5");

const profilerNetworks = parseSystemProfiler(profilerSample);
assert.strictEqual(profilerNetworks.length, 2);
assert.strictEqual(profilerNetworks[0].ssid, "OfficeWiFi");
assert.strictEqual(profilerNetworks[0].channel, 11);
assert.strictEqual(profilerNetworks[1].ssid, "NeighborNet");
assert.strictEqual(profilerNetworks[1].channel, 36);

console.log("scan parser tests passed");
