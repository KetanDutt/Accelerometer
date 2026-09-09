# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Liquid Glass design system** (`docs/DESIGN.md`): a tokenised material system
  with five material strengths (primary, secondary, tinted, warning, floating)
  plus a fill-only *inset* material for surfaces nested inside glass.
- **Centralised design tokens** in `css/tokens.css` — colours, glass opacity,
  blur levels, radii, shadows, spacing, type scale, motion durations, easings and
  z-index layers. Component sheets contain no raw values.
- **First-class dark mode** with an appearance menu (Auto / Light / Dark),
  resolved before first paint and persisted in `localStorage`.
- **Reduce motion switch** in the same menu, persisted, and honoured alongside
  `prefers-reduced-motion`. Also supports `prefers-reduced-transparency`,
  `prefers-contrast: more`, `forced-colors` and print.
- **Floating, scroll-reactive appbar** that firms up (more blur, more opacity,
  deeper shadow) as content scrolls underneath it.
- **Mobile dock navigation** below 900 px — a thumb-friendly floating glass bar
  with 44 px+ targets, replacing the segmented bar; both stay in sync.
- **Gliding navigation indicator** — the active pill animates between items and
  re-measures on resize, orientation change and font load.
- **Chart inspection** — glass crosshair tooltip on hover and via keyboard
  (arrows / Home / End / Esc), axis labels drawn from the data, a halo on the
  newest sample, and toggleable X/Y/Z series.
- **Confirmation dialog** for Clear (glass, focus-trapped, `Esc` and scrim
  dismiss, focus restored), replacing an immediate destructive action.
- **Toasts with follow-up actions** (e.g. *Download* straight after a copy) and
  an explicit dismiss control.
- **Micro-interactions**: pointer-tracking specular on buttons, self-drawing
  checkmarks after copy/download, crossfading control swaps, animated level
  meters in each readout, staggered section reveals.
- **Consistent inline SVG icon set** (one 24 px stroke grid) replacing the
  previous mixed glyphs.
- **Editor affordances**: a **Format** button, and a status chip that reports
  `Empty` / `N samples` / `Invalid JSON` / `Recording`.
- **Static audits**: WCAG contrast for every text token composited over its real
  surface, CSS class coverage, and token discipline (see `docs/DEVELOPMENT.md`).

#### Polish pass

- **Progressive appbar lift**: a veil bound to `--header-progress` (0 → 1 over
  the first 120 px of scroll) now carries the denser fill and deeper shadow
  continuously, instead of the header snapping at a single threshold. Only
  opacity animates, so the ramp stays on the compositor.
- **Readout loading skeleton**: until the app publishes `data-mode`, the four
  numerals wear a bar of the same size that breathes on opacity alone. Pure CSS,
  no reflow when the first sample lands.
- **Field-level editor error**: an invalid array grows a one-line hint under the
  textarea (icon + what to do) and collapses to zero height once it parses,
  instead of reporting the problem only in the chip above the field.
- **Series ink tokens** (`--series-x/y/z-ink`): readout numerals now use a
  deepened grade of the series hue and clear 4.5:1 as text, while chart lines and
  meters keep the brighter 3:1 graphical grade.
- **Tactile navigation**: segmented items and dock items compress slightly on
  press, matching the buttons.
- **Focused editor field** brightens (`--fill-sunken-focus`) alongside the border
  and focus ring.

### Changed

- **Stylesheet split**: `css/style.css` replaced by `tokens.css`, `base.css`,
  `components.css`, `layout.css` and `motion.css`.
- **Script split**: presentation behaviour moved to `js/ui.js` (`window.AccUI`);
  `js/app.js` keeps the application logic and degrades gracefully without it.
- **Ambient background** rebuilt as very low-contrast drifting fields with fine
  grain, replacing the previous saturated blobs.
- **Status hues** now come in two grades — a base hue for icons and series, and a
  higher-contrast variant for text — so chips and badges meet WCAG AA.
- **Filled buttons** use real hover/press colours instead of a brightness filter
  (which also lightened the blurred backdrop behind them).
- **Depth hierarchy**: the capture-controls panel moved from primary to secondary
  glass, so the live workspace is the focal point and the supporting column
  recedes behind it.
- **Hover elevation is now pointer-only** (`.readout`, `.details__row` join
  `.card--info` under `@media (hover: hover)`), so a tapped card on a phone no
  longer keeps its raised state.
- **Inset material declared once**: `.chart` and `.editor` re-declared the same
  background/border/shadow as the `.card--inset` they already carry; those rules
  now only add geometry.

### Fixed

- **`setVisible()` was not idempotent**: `updateStats()` re-asserts the stats
  panel every animation frame, which kept resetting the leave timer so a hidden
  panel could get stuck mid-fade, still present in the accessibility tree.
  Both directions are now no-ops when already in the target state.
- **Nested backdrop filters**: inset surfaces (readouts, chart, editor, stats)
  previously blurred a second time on top of an already-blurred panel; they are
  now translucent fills, which is both clearer and cheaper.
- **Secondary buttons carried their own `backdrop-filter`** while always sitting
  inside a glass panel — the last remaining nested blur, now removed (up to four
  of them were on screen at once in the export actions).
- **Empty-state outline** softened from `--hairline-strong` to `--hairline`: it
  was drawing a dashed second border directly on top of the textarea's own edge.
- **`prefers-reduced-transparency` + scroll**: `body.is-scrolled .appbar__inner`
  out-specified the reduced-transparency rule and put the translucent floating
  material back on the header. The scrolled state now only re-points blur,
  saturation and edge, so the solid surface survives the scroll.
- **Glass surfaces no longer use `overflow: hidden`**, so popovers and tooltips
  anchored inside them are not clipped.
- **Contrast failures** in the light theme: success button label (4.31:1),
  success chip (3.57:1), danger chip (4.04:1) and warning chip (3.76:1) now all
  clear 4.5:1.

### Preserved

- All application behaviour: `DeviceMotion` capture, the permission flow, the
  simulator, the rolling chart buffer, recording stats, the editable export
  textarea, JSON/CSV output, clipboard fallback and the invalid-JSON fallback.
  The exported sample schema (`t`, `x`, `y`, `z`, `mag`) is unchanged.

---

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
