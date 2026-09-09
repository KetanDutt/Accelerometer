# Accelerometer — Documentation

Welcome to the Accelerometer documentation. This page is the index and overview. Pick a document below for details.

## Table of contents

- [User guide (USAGE.md)](USAGE.md) — How to use the app from a normal user's perspective.
- [Developer & contribution guide (DEVELOPMENT.md)](DEVELOPMENT.md) — Setup, architecture, testing, and how to contribute.
- [Data format (DATA_FORMAT.md)](DATA_FORMAT.md) — The exact schema of exported JSON and CSV files.
- [Design system (DESIGN.md)](DESIGN.md) — Materials, tokens, motion and accessibility rules.
- [Changelog (CHANGELOG.md)](CHANGELOG.md) — Versioned history of changes and migration notes.

## What this project does

This is a **static, client-side web app** that reads the browser's `DeviceMotion` API to sample your device's linear acceleration (with gravity included) along the X, Y and Z axes. It then lets you:

- see the live readout and a real-time chart,
- record a session,
- and export the recorded samples as **JSON** or **CSV** for use in simulations, analyses, educational demos, or ML pipelines.

There is **no backend**. All computation happens in your browser, so no data is uploaded anywhere.

## Quick facts

| Topic | Detail |
| --- | --- |
| Hosting | Static site — deployable to GitHub Pages, Netlify, Vercel, or any static server. |
| Build step | None. Open `index.html` or serve the folder statically. |
| Dependencies | Zero runtime dependencies (no framework, no CDN). |
| Sensor data | Read via the `DeviceMotion` API (requires HTTPS + motion-capable device). |
| Formats | JSON array and CSV (with header row). |
| License | MIT |

## Architecture at a glance

```
index.html  ──►  css/tokens.css ─► base.css ─► components.css ─► layout.css ─► motion.css
        │
        ├────►  js/ui.js         (presentation: theme, popovers, dialogs, reveals)
        └────►  js/app.js        (application logic, in an IIFE, no globals leaked)
```

`js/ui.js` exposes one optional global, `window.AccUI`. `js/app.js` is one
self-contained module with clearly separated concerns:

- **DOM references** — cached element lookups.
- **State** — the current sensor/simulation/recording state and the data buffers.
- **Input sources** — real `DeviceMotion` and an in-browser *simulated* generator.
- **Rendering** — a throttled (`requestAnimationFrame`) canvas chart and readout updates.
- **Export** — JSON / CSV generation, clipboard copy, and file download.

## Getting started

1. **For users:** see [USAGE.md](USAGE.md).
2. **For developers:** see [DEVELOPMENT.md](DEVELOPMENT.md).
3. **For data consumers:** see [DATA_FORMAT.md](DATA_FORMAT.md).
