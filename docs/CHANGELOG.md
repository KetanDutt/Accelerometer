# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Complete rewrite into a clean, production-ready, dependency-free app.
- See the sections below for the cumulative changes vs. the original single-file version.

## [0.1.0] — 2026-09-07

### Added

- **3-axis readout** (X, Y, Z) plus **magnitude** (|g|) with live, throttled updates.
- **Real-time canvas chart** for X, Y and Z with a symmetric auto-scaling axis and grid.
- **Simulated data generator** for desktop/laptop browsers that have no accelerometer.
- **JSON export and CSV export** (with header row) and **copy to clipboard**.
- **Editable export textarea** — edit and re-export a JSON array; invalid edits fall back safely.
- **Recording statistics**: sample count, duration (s), and sample rate (Hz).
- **iOS 13+ / Android permission flow** with clear "Enable motion sensors" button and graceful messaging.
- **Accessibility & polish**: semantic HTML, ARIA labels, keyboard-visible focus, `prefers-reduced-motion`, responsive layout, no external CDN dependencies.
- **Inline SVG favicon** and `<meta>` description / theme-color.
- **Documentation**: `docs/` folder with user guide, developer guide, data format, and changelog; expanded `README.md`.

### Fixed

- **Duplicate `id="valY"`** — replaced with a proper Z-axis readout (`id="valZ"`).
- **Duplicate `id="StartRecording"`** on four different elements — replaced with unique IDs (`startBtn`, `stopBtn`, `copyBtn`, etc.). Duplicate IDs broke `getElementById`, so controls behaved incorrectly.
- **`event` vs. `e`** — `accelerometerUpdate(e)` referenced the global `event` instead of its parameter; now the parameter is used (and named `e` consistently, with a guarded fallback if `accelerationIncludingGravity` is absent).
- **Missing Z axis data** — previously only X and Y were recorded/exported.
- **Missing timestamps** — samples now carry a relative time `t` (ms), making the data usable for time-series analysis and simulation.
- **O(n²) DOM reflow on every frame** — the old `tbody.innerHTML += str` was replaced with a throttled `requestAnimationFrame` canvas renderer.
- **`dataFeild` typo** — corrected to `data-section`.
- **Unsafe inline `onclick` handlers** — replaced with `addEventListener` and unique, semantic IDs.
- **Dead commented data and unused code** (`exportToCsv` call, `msSaveBlob`, etc.) — removed.
- **No empty-state handling** — the app now shows a clear unsupported/permission/error UI instead of silently failing.
- **Canvas chart bug** — the live chart previously had no renderer at all; it now draws correctly on resize and uses device-pixel-ratio scaling for crispness.

### Improved

- Zero runtime dependencies (removed Materialize + Google Material Icons CDN), improving load time and offline behavior.
- Performance: coalesced rendering, capped rolling buffer, and streamed recording without touching the DOM per frame.
- UI/UX: dark, responsive, accessible redesign with hover/focus states and a recording badge.
- Code quality: modular IIFE, cached DOM refs, named functions, JSDoc-style comments, `"use strict"`.

### Removed

- External CDN scripts/stylesheets (Materialize, Material Icons).
- Inline `onclick` attributes, inline styles, and the commented-out sample data block.
- Unused browser-compat code paths (old `msSaveBlob` / IE handling).

---

*The original version was a single `index.html` file reading X and Y only. This rewrite preserves its purpose (record & export accelerometer data for simulation) while making it robust, performant, documented, and production-ready.*
