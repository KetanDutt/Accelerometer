# Developer & contribution guide

This document explains how the project is structured, how to run and test it locally, and how to contribute.

## Requirements

- Any modern browser.
- A simple static file server (optional, but recommended, so the `DeviceMotion` API is available on `localhost`/HTTPS). `python3 -m http.server`, Node's `npx serve`, or VS Code's Live Server all work.
- No build tooling is required — the project is plain HTML/CSS/JS.

## Running locally

From the repository root:

```bash
# Option A: Python
python3 -m http.server 8000

# Option B: Node
npx serve .

# Option C: Node one-liner
npx http-server -p 8000
```

Then open `http://localhost:8000`.

> The `DeviceMotion` API is available on `localhost` (and any HTTPS origin). If you open `index.html` directly via `file://`, motion access may be unavailable — use a local server.

## Project structure

```
Accelerometer/
├── index.html          # Markup / layout and asset references
├── css/
│   └── style.css       # Styling (dark, responsive, framework-free)
├── js/
│   └── app.js          # All application logic (single IIFE)
├── docs/               # Documentation
├── LICENSE             # MIT
└── README.md
```

## Architecture

`js/app.js` uses an **IIFE** (`(function () { ... })()`) so nothing leaks into the global scope. Important modules inside it:

| Concern | Where in `app.js` |
| --- | --- |
| DOM references | `els` object near the top |
| State | `state` object |
| Input: real sensor | `onDeviceMotion`, `requestPermission`, `enableSensor` |
| Input: simulation | `startSim` / `stopSim` / `toggleSim` |
| Sample processing | `processSample` (updates readout, rolling chart buffer, record buffer) |
| Rendering | `scheduleRender` → `renderChart` (canvas) + `updateStats` |
| Export | `getActiveSamples`, `samplesToCsv`, `downloadCsv`, `downloadJson`, `copyData` |
| Wiring | `bindEvents`, `init` |

### Key design decisions

- **Zero runtime dependencies.** No CDN, no framework, no icon font. This keeps the app fast, offline-capable, and avoids supply-chain risk.
- **Throttled rendering.** Sensor events can fire ~60+ times per second. Chart and stat updates are coalesced through a single `requestAnimationFrame` (`scheduleRender`), and the live chart only keeps the latest `MAX_ROLLING = 600` samples in the rolling buffer, so drawing cost stays constant even during long recordings.
- **Editable export.** The export functions prefer a valid JSON array in the textarea (if the user edited it) and only fall back to the raw recording if that is absent or invalid.
- **Graceful capability detection.** The app distinguishes *permission required* (iOS 13+ / Android), *available* (granted), and *unavailable* (no `DeviceMotion`), so each platform gets a correct message.
- **Accessibility.** Semantic HTML, ARIA labels (`role="alert"`, `aria-label` on canvas), keyboard-visible focus, and `prefers-reduced-motion` support.

## Data model

A sample is:

```ts
interface Sample {
  t: number;    // milliseconds since recording began (performance.now baseline)
  x: number;    // m/s², including gravity
  y: number;
  z: number;
  mag: number;  // sqrt(x² + y² + z²)
}
```

See [DATA_FORMAT.md](DATA_FORMAT.md) for the full format.

## Testing

The project intentionally has no build step, so testing is lightweight:

1. **Manual smoke test:** open the app locally, click **Simulate data**, start/stop recording, verify the chart and export work.
2. **Static checks** (in a shell, from the repo root):
   ```bash
   node --check js/app.js            # verify JS syntax
   # check for duplicate element IDs
   python3 -c "import html.parser; ..."   # (see CI snippet below)
   ```
3. **Headless smoke test** with Node + `jsdom` (optional, dev-only):
   - Inline `js/app.js` into the HTML, load with `runScripts: "dangerously"`, then drive the buttons. Verify no runtime errors and that recording populates the textarea.

### CI-style duplicate-ID check

```bash
python3 - <<'PY'
import html.parser
from collections import Counter
class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = []
    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k == 'id': self.ids.append(v)
p = P(); p.feed(open('index.html').read())
dups = {k: v for k, v in Counter(p.ids).items() if v > 1}
assert not dups, f"Duplicate IDs: {dups}"
print("OK: no duplicate IDs")
PY
```

## Deploying

This is a fully static site, so any static host works. Because it must be served over HTTPS to expose the `DeviceMotion` API, use:

- **GitHub Pages** — push to a repo and enable Pages (see `.github/workflows/pages.yml` if present).
- **Netlify / Vercel / Cloudflare Pages** — connect the repo, no build command needed.

### GitHub Pages quick setup

1. Push the branch to GitHub.
2. Repository → **Settings** → **Pages** → source = the branch, `/ (root)`.
3. The site is served at `https://<user>.github.io/<repo>/`.

## Contributing

1. Fork the repo and create a feature branch.
2. Make focused changes; keep the zero-dependency, no-build philosophy unless there's a strong reason.
3. Update the relevant docs and the `CHANGELOG`.
4. Submit a pull request with a clear description.

### Code style

- 4-space indentation; consistent quotes and semicolons.
- Prefer small, single-purpose functions.
- Add a brief comment for non-obvious logic (e.g., why a buffer is capped, why rendering is throttled).
- Test on both a motion-capable device and a desktop (simulator) before submitting.

## Performance considerations

- Keep the per-frame work minimal: avoid allocating large arrays on each sensor event, avoid touching the DOM more than necessary, and never rebuild the whole chart on every event — throttle via `requestAnimationFrame`.
- The rolling buffer caps the chart's memory and render cost even for long recordings; the full dataset is kept separately in `state.data`.
- When recording at high update rates, the textarea is only populated on stop (not on every frame) to avoid jank.

## Troubleshooting

| Issue | Likely cause / fix |
| --- | --- |
| `requestPermission` doesn't exist | Running on a browser without the iOS/Android permission gate — the code already falls back to `enableSensor()`. |
| Chart is blank | The canvas has zero size (e.g., its container is `display:none`). Ensure the app view is visible when `renderChart` runs. |
| Motion event not firing | Not on HTTPS/localhost, or permission denied. |
