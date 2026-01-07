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

Samples are stored in `server/samples.json`.

## API
- `GET /api/meta` → `{ ssid, band, rssi, mode }`
- `GET /api/samples` → `[]`
- `POST /api/sample` → `{ x, y }` (reads RSSI and stores sample)
- `POST /api/reset` → clears samples

## Calibration
RSSI values are typically between **-30 dBm (very strong)** and **-90 dBm (weak)**. Aim to sample at multiple points around a room to get a smooth heatmap.

## Modes
- **heatmap**: click on the floor plan to capture samples and render a heatmap.
- **spectrum**: enables the Spectrum tab to show a live RSSI timeline (polls every 500ms).
