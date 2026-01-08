const assert = require("assert");
const { computeCongestion } = require("../channels");

const networks = [
  { ssid: "A", rssi_dbm: -45, channel: 1, band: "2.4" },
  { ssid: "B", rssi_dbm: -50, channel: 6, band: "2.4" },
  { ssid: "C", rssi_dbm: -70, channel: 36, band: "5" },
  { ssid: "D", rssi_dbm: -65, channel: 40, band: "5" },
];

const report = computeCongestion(networks);
assert.ok(report.band24);
assert.ok(report.band5);
assert.strictEqual(report.band24.recommended.width_mhz, 20);
assert.ok([1, 6, 11].includes(report.band24.recommended.channel));
assert.ok([40, 80].includes(report.band5.recommended.width_mhz));
assert.ok(report.band5.recommended.channel);

console.log("channel scoring tests passed");
