# User guide

This guide explains how to use the Accelerometer web app.

## Prerequisites

- A **motion-capable device** (phone or tablet) with a browser that supports the `DeviceMotion` API.
- A **secure connection (HTTPS)**. The `DeviceMotion` API is only available on secure origins (HTTPS, or `localhost`). GitHub Pages, Netlify, and Vercel all serve over HTTPS.
- **JavaScript** enabled in the browser.

## Step 1 — Open the app

Visit the hosted demo or open `index.html`. On a desktop you'll see the **Simulate data** button and a message that motion sensors aren't available; on a phone you'll be asked to grant permission.

## Step 2 — Grant motion permission

- **iOS Safari 13+** and some Android browsers require an explicit permission prompt. Click the **Enable motion sensors** button and then **Allow** in the browser dialog.
- If permission is **denied**, you'll see a helpful message. You can change this later in your browser's site settings.

## Step 3 — Start recording

1. Click **Start recording**. A red **● Recording** badge appears and the stats panel becomes visible.
2. Move or rotate your device. The live readout (X, Y, Z and magnitude) and the chart update in real time.
3. Click **Stop recording** when you're done.

> Small tip: try to keep the device reasonably still before starting and avoid jittery movements if you want clean data. The chart shows a symmetric scale around zero so you can see the X/Y/Z traces clearly.

## Step 4 — Export your data

After stopping, the **Recorded data** section appears with your data in an editable textbox and four buttons:

| Button | What it does |
| --- | --- |
| **Copy JSON** | Copies the formatted JSON array to the clipboard. |
| **Download JSON** | Saves `accelerometer-<timestamp>.json`. |
| **Download CSV** | Saves `accelerometer-<timestamp>.csv` with a header row. |
| **Clear** | Asks for confirmation, then discards the recorded data and resets the view. |
| **Format** | Re-indents the JSON in the editor (enabled only while the JSON is valid). |

### Editing and re-exporting

The exported data is shown as text you can edit. If you change it to a **valid JSON array**, the **Copy** and **Download** buttons use your edited version instead of the original recording. If you break the JSON syntax, the app safely falls back to the last recorded
session; the editor border and the status chip turn to a calm error state so you
can see what happened.

## Using the simulator (desktop / no sensor)

Click **Simulate data** to generate a gentle 3-axis oscillation using your display refresh (≈60 Hz). This lets you:

- see the chart and readout,
- record and export a synthetic dataset,
- and verify the whole app on a laptop or desktop.

Click **Simulate data** again (it becomes **Stop simulation**) to stop.

## Inspecting the chart

- **Hover** anywhere on the chart to pin a glass crosshair and read the exact
  X, Y and Z values at that sample (with its timestamp).
- **Keyboard:** focus the chart and use <kbd>←</kbd> / <kbd>→</kbd>
  (<kbd>Shift</kbd> for ×10), <kbd>Home</kbd> / <kbd>End</kbd>, or
  <kbd>Esc</kbd> to clear the cursor.
- **Series toggles:** the X / Y / Z legend buttons hide or show a trace
  (`aria-pressed` reflects the state), which is useful when one axis dominates.

## Appearance and motion

The button at the right of the header opens the appearance menu:

| Option | Effect |
| --- | --- |
| **Auto** | Follows your system light/dark setting (default). |
| **Light** / **Dark** | Forces that theme. |
| **Reduce motion** | Turns off travel and ambient animation while keeping every state change visible. |

Your choices are remembered on this device (`localStorage`) — nothing is sent
anywhere. The app also follows the OS settings for reduced motion, reduced
transparency and higher contrast.

## What the readout numbers mean

The app reads `accelerationIncludingGravity`. This is the acceleration (in m/s²) that a device experiences, **including** the force of gravity. When the device is flat and still, Z is typically ≈ **9.81 m/s²** (≈ 1 g) and X/Y are ≈ 0. The **magnitude** is `sqrt(x² + y² + z²)` and is useful for detecting overall motion intensity.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| "Motion sensors not available" | You're likely on a desktop/laptop without motion sensors. Use **Simulate data**. On an iPhone, make sure you clicked **Enable motion sensors**. |
| The permission prompt doesn't appear | Make sure you're on **HTTPS** (not `http://`) and reload the page. |
| Buttons are disabled | Motion access must be **granted** (or the simulator started) before you can record. |
| Recorded data is empty | You stopped before moving the device, or permission was denied. Try again. |
| Download doesn't work | Some strict browsers block downloads. Try **Copy JSON** instead and paste into an editor. |
