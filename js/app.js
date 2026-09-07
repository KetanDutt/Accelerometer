/* =========================================================================
   Accelerometer — application logic
   Reads the DeviceMotion API, visualises live X/Y/Z, records samples and
   exports data as JSON or CSV. No external dependencies.
   ========================================================================= */

(function () {
    "use strict";

    // ---------- DOM references ----------
    const el = (id) => document.getElementById(id);

    const els = {
        permissionSection: el("permission-section"),
        permissionBtn: el("permission-btn"),
        permissionNote: el("permission-note"),
        unsupportedSection: el("unsupported-section"),
        unsupportedNote: el("unsupported-note"),
        startBtn: el("startBtn"),
        stopBtn: el("stopBtn"),
        simBtn: el("simBtn"),
        recordingBadge: el("recording-badge"),
        valX: el("valX"),
        valY: el("valY"),
        valZ: el("valZ"),
        valMag: el("valMag"),
        chart: el("chart"),
        stats: el("stats"),
        statCount: el("statCount"),
        statDuration: el("statDuration"),
        statRate: el("statRate"),
        dataSection: el("data-section"),
        textarea: el("textarea"),
        copyBtn: el("copyBtn"),
        downloadJsonBtn: el("downloadJsonBtn"),
        downloadCsvBtn: el("downloadCsvBtn"),
        clearBtn: el("clearBtn"),
        err: el("err"),
    };

    // ---------- State ----------
    const state = {
        sensorEnabled: false, // real device motion granted/available
        simRunning: false,    // synthetic demo data generator is on
        recording: false,     // currently recording samples
        data: [],             // recorded samples: { t, x, y, z, mag }
        rolling: [],          // rolling buffer of recent samples for the live chart
        startTime: 0,         // performance.now() when recording started
        simTime: 0,           // elapsed ms of the simulation
        simTimer: null,
        rafId: null,
        lastX: 0,
        lastY: 0,
        lastZ: 0,
    };

    // Keep the live chart cheap by limiting how many samples we draw.
    const MAX_ROLLING = 600;
    const SIM_INTERVAL_MS = 16; // ~60 Hz simulated sampling

    // ---------- Helpers ----------
    function format(n, digits = 2) {
        if (!Number.isFinite(n)) return "0.00";
        return Number(n).toFixed(digits);
    }

    function numberOr(v, fallback = 0) {
        return (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
    }

    function showError(message) {
        els.err.classList.remove("notice-success");
        els.err.classList.add("notice-error");
        els.err.textContent = message;
        els.err.hidden = !message;
    }

    // Success feedback reuses the notice element but styles it as positive.
    function showSuccess(message) {
        els.err.classList.remove("notice-error");
        els.err.classList.add("notice-success");
        els.err.textContent = message;
        els.err.hidden = !message;
    }

    function clearNotice() {
        els.err.hidden = true;
        els.err.textContent = "";
    }

    // ---------- Sample processing ----------
    // Accepts { x, y, z } and drives the readout, the rolling chart buffer
    // and (when recording) the persistent dataset.
    function processSample(accel) {
        const x = numberOr(accel.x);
        const y = numberOr(accel.y);
        const z = numberOr(accel.z);
        const mag = Math.hypot(x, y, z);

        state.lastX = x;
        state.lastY = y;
        state.lastZ = z;

        updateReadout(x, y, z, mag);

        state.rolling.push({ x, y, z });
        if (state.rolling.length > MAX_ROLLING) {
            state.rolling.splice(0, state.rolling.length - MAX_ROLLING);
        }

        if (state.recording) {
            const t = performance.now() - state.startTime;
            state.data.push({ t, x, y, z, mag });
        }

        scheduleRender();
    }

    function updateReadout(x, y, z, mag) {
        els.valX.textContent = format(x);
        els.valY.textContent = format(y);
        els.valZ.textContent = format(z);
        els.valMag.textContent = format(mag);
    }

    // ---------- DeviceMotion ----------
    function onDeviceMotion(e) {
        // Prefer the acceleration including gravity; fall back gracefully.
        const a = e.accelerationIncludingGravity || e.acceleration || {};
        processSample({ x: a.x, y: a.y, z: a.z });
    }

    function enableSensor() {
        state.sensorEnabled = true;
        els.permissionSection.hidden = true;
        els.unsupportedSection.hidden = true;
        if (typeof window.DeviceMotionEvent !== "undefined") {
            window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
        }
        updateControls();
        clearNotice();
    }

    async function requestPermission() {
        try {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission === "granted") {
                enableSensor();
            } else {
                showUnsupported("Motion sensor permission was denied. Enable it in your browser settings and reload.");
            }
        } catch (err) {
            showUnsupported(`Could not request motion permission: ${err.message || "unknown error"}.`);
        }
    }

    function showPermission() {
        els.permissionSection.hidden = false;
        els.unsupportedSection.hidden = true;
    }

    function showUnsupported(note) {
        els.unsupportedSection.hidden = false;
        els.unsupportedNote.textContent = note || "Motion sensors are not available on this device.";
        els.permissionSection.hidden = true;
        updateControls();
    }

    // ---------- Controls ----------
    function updateControls() {
        const canRecord = state.sensorEnabled || state.simRunning;
        els.startBtn.hidden = !canRecord || state.recording;
        els.stopBtn.hidden = !state.recording;
        els.recordingBadge.hidden = !state.recording;
    }

    function startRecording() {
        if (!(state.sensorEnabled || state.simRunning)) {
            showError("Enable motion access or start simulated data before recording.");
            return;
        }
        state.recording = true;
        state.data = [];
        state.startTime = performance.now();
        els.dataSection.hidden = true; // keep the data panel out of the way while streaming
        updateControls();
        clearNotice();
    }

    function stopRecording() {
        state.recording = false;
        updateControls();

        if (state.data.length > 0) {
            els.textarea.value = JSON.stringify(state.data, null, 2);
            els.dataSection.hidden = false;
        } else {
            els.dataSection.hidden = true;
        }
        scheduleRender();
    }

    function clearData() {
        state.data = [];
        state.rolling = [];
        els.textarea.value = "";
        els.dataSection.hidden = true;
        updateStats();
        scheduleRender();
        clearNotice();
    }

    // ---------- Simulation (desktop demo / preview) ----------
    function toggleSim() {
        if (state.simRunning) {
            stopSim();
        } else {
            startSim();
        }
    }

    function startSim() {
        state.simRunning = true;
        state.simTime = 0;
        els.simBtn.textContent = "Stop simulate";
        els.simBtn.classList.add("active");
        state.simTimer = setInterval(() => {
            state.simTime += SIM_INTERVAL_MS;
            const t = state.simTime / 1000;
            // A gentle 3-axis oscillation so X/Y/Z are all visibly different.
            const x = Math.sin(2 * Math.PI * 0.5 * t) * 2.5;
            const y = Math.cos(2 * Math.PI * 0.5 * t) * 2.5;
            const z = Math.sin(2 * Math.PI * 0.2 * t) * 3 + 9.8;
            processSample({ x, y, z });
        }, SIM_INTERVAL_MS);
        updateControls();
    }

    function stopSim() {
        clearInterval(state.simTimer);
        state.simTimer = null;
        state.simRunning = false;
        els.simBtn.textContent = "Simulate data";
        els.simBtn.classList.remove("active");
        updateControls();
    }

    // ---------- Stats ----------
    function updateStats() {
        const hasData = state.recording || state.data.length > 0;
        els.stats.hidden = !hasData;
        if (!hasData) return;

        let durationMs;
        if (state.recording) {
            durationMs = performance.now() - state.startTime;
        } else {
            const last = state.data[state.data.length - 1];
            durationMs = last ? last.t : 0;
        }

        const seconds = durationMs / 1000;
        const rate = seconds > 0 ? state.data.length / seconds : 0;

        els.statCount.textContent = String(state.data.length);
        els.statDuration.textContent = `${format(seconds, 1)}s`;
        els.statRate.textContent = `${Math.round(rate)} Hz`;
    }

    // ---------- Rendering (throttled via requestAnimationFrame) ----------
    function scheduleRender() {
        if (state.rafId !== null) return;
        state.rafId = requestAnimationFrame(() => {
            state.rafId = null;
            renderChart();
            updateStats();
        });
    }

    function renderChart() {
        const canvas = els.chart;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const w = rect.width;
        const h = rect.height;
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
        }

        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const samples = state.rolling;
        if (samples.length < 2) {
            drawGrid(ctx, w, h, 0);
            return;
        }

        // Find a symmetric scale around 0 using the largest absolute value.
        let maxAbs = 1;
        for (const s of samples) {
            maxAbs = Math.max(maxAbs, Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        }
        maxAbs = Math.ceil(maxAbs * 1.15);

        drawGrid(ctx, w, h, maxAbs);

        const xToPx = (i) => (i / (samples.length - 1)) * (w - 1);
        const yToPx = (v) => h / 2 - (v / maxAbs) * (h / 2 - 8);

        drawSeries(ctx, samples, "x", xToPx, yToPx, "#38bdf8");
        drawSeries(ctx, samples, "y", xToPx, yToPx, "#4ade80");
        drawSeries(ctx, samples, "z", xToPx, yToPx, "#fbbf24");
    }

    function drawGrid(ctx, w, h, maxAbs) {
        ctx.strokeStyle = "#27334a";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;

        // Horizontal grid lines.
        const rows = 4;
        for (let i = 0; i <= rows; i++) {
            const y = (i / rows) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Vertical grid lines.
        const cols = 8;
        for (let i = 0; i <= cols; i++) {
            const x = (i / cols) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Zero axis.
        ctx.strokeStyle = "#3f4d68";
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        ctx.globalAlpha = 1;
    }

    function drawSeries(ctx, samples, key, xToPx, yToPx, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.75;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (let i = 0; i < samples.length; i++) {
            const x = xToPx(i);
            const y = yToPx(samples[i][key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // ---------- Export ----------
    // When the textarea has been edited to a valid JSON array, prefer that,
    // otherwise fall back to the recorded data.
    function getActiveSamples() {
        const raw = els.textarea.value.trim();
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            } catch (_) {
                // Fall through to recorded data if the edit is invalid.
            }
        }
        return state.data;
    }

    function samplesToCsv(samples) {
        const header = "time,x,y,z,magnitude";
        const rows = samples.map((s) => {
            const t = (s && s.t != null) ? s.t : "";
            const x = (s && s.x != null) ? s.x : "";
            const y = (s && s.y != null) ? s.y : "";
            const z = (s && s.z != null) ? s.z : "";
            const mag = (s && s.mag != null) ? s.mag : "";
            return [t, x, y, z, mag].map(cellToCsv).join(",");
        });
        return [header].concat(rows).join("\n");
    }

    function cellToCsv(value) {
        const v = (value == null) ? "" : String(value);
        if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
        return v;
    }

    function fileName(prefix, ext) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        return `${prefix}-${stamp}.${ext}`;
    }

    function downloadBlob(content, mime, name) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function downloadCsv() {
        const samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to download yet.");
            return;
        }
        downloadBlob(samplesToCsv(samples), "text/csv;charset=utf-8;", fileName("accelerometer", "csv"));
    }

    function downloadJson() {
        const samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to download yet.");
            return;
        }
        downloadBlob(JSON.stringify(samples, null, 2), "application/json;charset=utf-8;", fileName("accelerometer", "json"));
    }

    async function copyData() {
        const samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to copy yet.");
            return;
        }
        const text = JSON.stringify(samples, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            flashSuccess("Copied JSON to clipboard.");
        } catch (err) {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (err) {
            ok = false;
        }
        document.body.removeChild(ta);
        if (ok) {
            flashSuccess("Copied JSON to clipboard.");
        } else {
            showError("Could not copy to clipboard — select the text manually.");
        }
    }

    // Small, dependency-free toast so feedback doesn't need a library.
    function flashSuccess(message) {
        showSuccess(message);
        setTimeout(clearNotice, 2400);
    }

    // ---------- Binding ----------
    function bindEvents() {
        els.permissionBtn.addEventListener("click", requestPermission);
        els.startBtn.addEventListener("click", startRecording);
        els.stopBtn.addEventListener("click", stopRecording);
        els.clearBtn.addEventListener("click", clearData);
        els.copyBtn.addEventListener("click", copyData);
        els.downloadJsonBtn.addEventListener("click", downloadJson);
        els.downloadCsvBtn.addEventListener("click", downloadCsv);
        els.simBtn.addEventListener("click", toggleSim);
        window.addEventListener("resize", scheduleRender);
    }

    // ---------- Init ----------
    function init() {
        bindEvents();
        updateControls();

        if (typeof window.DeviceMotionEvent === "undefined") {
            showUnsupported("This browser does not support the DeviceMotion API. Use the simulated data above.");
        } else if (typeof DeviceMotionEvent.requestPermission === "function") {
            // iOS 13+ and some Android browsers require an explicit permission.
            showPermission();
        } else {
            enableSensor();
        }

        // Draw an empty chart so the card looks intentional on load.
        requestAnimationFrame(renderChart);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
