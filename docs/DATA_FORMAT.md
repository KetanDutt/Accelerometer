# Data format

This document describes the exact structure of the data exported by the app, so you can reliably consume it in simulations, analyses, and pipelines.

## Overview

The app reads the browser's `DeviceMotion` event and exposes `accelerationIncludingGravity`. That value is the linear acceleration (in **m/s²**) of the device **including** the effect of gravity. Recording captures a time-ordered sequence of samples.

## Sample object

Each recorded sample is a JSON object with these fields:

| Field | Type | Unit | Description |
| --- | --- | --- | --- |
| `t` | number | milliseconds | Time relative to the start of the recording session (a `performance.now()` baseline). |
| `x` | number | m/s² | Acceleration along the device's X axis (including gravity). |
| `y` | number | m/s² | Acceleration along the device's Y axis (including gravity). |
| `z` | number | m/s² | Acceleration along the device's Z axis (including gravity). |
| `mag` | number | m/s² | Magnitude `sqrt(x² + y² + z²)`. |

Example:

```json
{
  "t": 120.4,
  "x": 0.12,
  "y": -0.03,
  "z": 9.81,
  "mag": 9.81
}
```

## JSON export

The full export is a **JSON array of sample objects**, pretty-printed for readability:

```json
[
  {
    "t": 0,
    "x": 0.05,
    "y": -0.02,
    "z": 9.8,
    "mag": 9.8
  },
  {
    "t": 16.7,
    "x": 1.12,
    "y": 0.4,
    "z": 9.41,
    "mag": 9.5
  }
]
```

Consuming in JavaScript:

```js
const samples = await (await fetch("accelerometer-...json")).json();
const first = samples[0];
console.log(first.x, first.y, first.z, first.mag);
```

> **Note:** timestamps are in **milliseconds** and are relative to the start of each recording, so a fresh recording always begins near `0`. They are not wall-clock times.

## CSV export

The CSV export uses a header row and one row per sample. Columns are comma-separated; values are quoted when they contain a comma, quote, or newline.

```
time,x,y,z,magnitude
0,0.05,-0.02,9.8,9.8
16.7,1.12,0.4,9.41,9.5
```

Consuming in Python (Pandas):

```python
import pandas as pd
df = pd.read_csv("accelerometer-...csv")
print(df.describe())
```

Consuming in Python (stdlib):

```python
import csv
with open("accelerometer-...csv", newline="") as f:
    for row in csv.DictReader(f):
        print(row["x"], row["y"], row["z"])
```

## Units and direction conventions

- **Units:** acceleration in **m/s²**, per W3C `DeviceMotion` convention. Earth's gravity is ≈ `9.81 m/s²`.
- **Including gravity:** because the app reads `accelerationIncludingGravity`, a stationary device resting flat will report **Z ≈ 9.81** and X/Y ≈ 0, rather than ≈ 0 on all axes. Use the magnitude `mag` when you want a single "how much is it moving?" value independent of orientation.
- **Axes** follow the device coordinate system used by the browser (typically X = rightward, Y = upward/toward the top of the device in portrait, Z = perpendicular to the screen). The exact mapping is device- and orientation-dependent, so for absolute/cross-device comparisons you may need to apply your own orientation compensation.

## Notes and caveats

- Sampling frequency is **browser- and device-dependent** (typically 20–100 Hz). The reported sample rate in the UI is an approximation.
- The **rolling live chart** only retains the latest `MAX_ROLLING = 600` samples for performance; the **exported dataset** always contains the full recording.
- If you **edit** the textarea to a different valid JSON **array**, the app will copy/download your edited version. Invalid edits fall back to the raw recording.
