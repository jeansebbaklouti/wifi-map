# wifi-heatmap

Local Wi-Fi sampling toolkit with a Node/Express API and a Vite vanilla UI.

## Repo layout
- `server/` – Express API (port `8787`)
- `web/` – Vite UI (port `5173`)

## Requirements
- Node.js 18+
- npm or pnpm

## Setup
```bash
cd server
npm install

cd ../web
npm install
```

## Run (two terminals)
```bash
# Terminal 1
cd server
npm run dev
```

```bash
# Terminal 2
cd web
npm run dev -- --host
```

Open: http://localhost:5173

## Configuration
- `MODE` (default: `heatmap`, allowed: `spectrum`)
- `WIFI_IFACE` (Linux only, default: `wlan0`)

Example:
```bash
MODE=heatmap WIFI_IFACE=wlan0 npm run dev
```

Samples and floor plans are stored per project in `server/data/`.

## API
- `GET /api/meta` → `{ ssid, band, rssi, mode }`
- `GET /api/metrics` → available metrics for heatmap
- `GET /api/scan` → channel scan (macOS only, cached)
- `GET /api/channels` → congestion report (macOS only)
- `GET /api/samples` → `[]`
- `POST /api/sample` → `{ x, y }` (reads RSSI and stores sample)
- `POST /api/reset` → clears samples
- `GET /api/projects` → list projects
- `POST /api/projects` → `{ name }` create project

## Calibration
RSSI values are typically between **-30 dBm (very strong)** and **-90 dBm (weak)**. Aim to sample at multiple points around a room to get a smooth heatmap.

## Metric heatmap (macOS)
You can switch the heatmap to plot different metrics:
- **RSSI**: raw signal strength.
- **SNR**: signal-to-noise ratio (RSSI - Noise).
- **Latency/Jitter/Loss**: ping to the local router to isolate Wi-Fi quality.

Latency, jitter, and loss are based on pinging the gateway, which avoids external internet effects.

## Channels diagnostic (macOS)
- The scan estimates congestion by weighting nearby networks by RSSI (stronger = higher impact).
- 2.4 GHz: uses overlap between adjacent channels, and recommends among 1/6/11 at 20 MHz.
- 5 GHz: counts per-channel congestion and recommends 80 MHz when low congestion, otherwise 40 MHz for stability.

## Modes
- **heatmap**: click on the floor plan to capture samples and render a heatmap.
- **spectrum**: enables the Spectrum tab to show a live RSSI timeline (polls every 500ms).
