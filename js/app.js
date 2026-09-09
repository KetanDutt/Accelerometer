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
        readoutX: el("readoutX"),
        readoutY: el("readoutY"),
        readoutZ: el("readoutZ"),
        readoutMag: el("readoutMag"),
        chart: el("chart"),
        stats: el("stats"),
        statCount: el("statCount"),
        statDuration: el("statDuration"),
        statRate: el("statRate"),
        sessionStatus: el("sessionStatus"),
        liveNote: el("liveNote"),
        sensorStatus: el("sensorStatus"),
        sourceStatus: el("sourceStatus"),
        modeStatus: el("modeStatus"),
        stateStatus: el("stateStatus"),
        dataSection: el("data-section"),
        dataSummary: el("dataSummary"),
        emptyState: el("emptyState"),
        emptyStateTitle: el("emptyStateTitle"),
        emptyStateText: el("emptyStateText"),
        textarea: el("textarea"),
        copyBtn: el("copyBtn"),
        downloadJsonBtn: el("downloadJsonBtn"),
        downloadCsvBtn: el("downloadCsvBtn"),
        clearBtn: el("clearBtn"),
        err: el("err"),
        navLinks: Array.from(document.querySelectorAll(".nav-link")),
        navSections: Array.from(document.querySelectorAll("[data-nav-section]")),
        revealNodes: Array.from(document.querySelectorAll("[data-reveal]")),
    };

    // ---------- State ----------
    const state = {
        sensorEnabled: false,
        simRunning: false,
        recording: false,
        data: [],
        rolling: [],
        startTime: 0,
        simTime: 0,
        simTimer: null,
        rafId: null,
        lastX: 0,
        lastY: 0,
        lastZ: 0,
        noticeTimer: null,
        hideNoticeTimer: null,
        revealObserver: null,
        navObserver: null,
        prefersReducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };

    const MAX_ROLLING = 600;
    const SIM_INTERVAL_MS = 16;

    // ---------- Helpers ----------
    function format(n, digits = 2) {
        if (!Number.isFinite(n)) return Number(0).toFixed(digits);
        return Number(n).toFixed(digits);
    }

    function numberOr(v, fallback = 0) {
        return (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
    }

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function hexToRgb(hex) {
        const value = String(hex || "").replace("#", "").trim();
        if (value.length !== 6) return null;
        const num = Number.parseInt(value, 16);
        if (!Number.isFinite(num)) return null;
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255,
        };
    }

    function withAlpha(color, alpha) {
        if (!color) return `rgba(255, 255, 255, ${alpha})`;
        if (color.startsWith("rgba(")) {
            return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3,${alpha})`);
        }
        if (color.startsWith("rgb(")) {
            return color.replace(/rgb\(([^,]+),([^,]+),([^,]+)\)/, `rgba($1,$2,$3,${alpha})`);
        }
        if (color.startsWith("#")) {
            const rgb = hexToRgb(color);
            if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }
        return color;
    }

    function setNotice(message, type) {
        clearTimeout(state.noticeTimer);
        clearTimeout(state.hideNoticeTimer);

        els.err.hidden = false;
        els.err.classList.remove("toast-success", "toast-error", "is-visible");
        els.err.classList.add(type === "error" ? "toast-error" : "toast-success");
        els.err.textContent = message;
        els.err.setAttribute("role", type === "error" ? "alert" : "status");
        els.err.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

        requestAnimationFrame(() => {
            els.err.classList.add("is-visible");
        });
    }

    function showError(message) {
        setNotice(message, "error");
    }

    function showSuccess(message) {
        setNotice(message, "success");
    }

    function clearNotice(immediate) {
        clearTimeout(state.noticeTimer);
        clearTimeout(state.hideNoticeTimer);

        if (els.err.hidden) return;
        els.err.classList.remove("is-visible");

        const hide = function () {
            els.err.hidden = true;
            els.err.textContent = "";
            els.err.classList.remove("toast-success", "toast-error");
        };

        if (immediate || state.prefersReducedMotion) {
            hide();
            return;
        }

        state.hideNoticeTimer = setTimeout(hide, 220);
    }

    function flashSuccess(message) {
        showSuccess(message);
        state.noticeTimer = setTimeout(() => clearNotice(false), 2200);
    }

    function setReadoutLevel(node, value, maxAbs) {
        if (!node) return;
        const normalized = Math.max(0, Math.min(Math.abs(numberOr(value)) / maxAbs, 1));
        node.style.setProperty("--level", normalized.toFixed(3));
    }

    function setChipVariant(node, variant) {
        if (!node) return;
        node.classList.remove("status-chip-live", "status-chip-warning", "status-chip-danger", "status-chip-subtle");
        node.classList.add(`status-chip-${variant}`);
    }

    // ---------- Sample processing ----------
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

        setReadoutLevel(els.readoutX, x, 12);
        setReadoutLevel(els.readoutY, y, 12);
        setReadoutLevel(els.readoutZ, z - 9.8, 12);
        setReadoutLevel(els.readoutMag, mag, 20);
    }

    // ---------- DeviceMotion ----------
    function onDeviceMotion(e) {
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
        refreshDataSection();
        clearNotice(true);
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
        updateControls();
        refreshDataSection();
    }

    function showUnsupported(note) {
        els.unsupportedSection.hidden = false;
        els.unsupportedNote.textContent = note || "Motion sensors are not available on this device.";
        els.permissionSection.hidden = true;
        updateControls();
        refreshDataSection();
    }

    // ---------- UI status ----------
    function updateStatusText() {
        let headerStatus = "Checking sensors";
        let headerVariant = "subtle";
        let sessionTitle = "Preparing workspace";
        let sessionNote = "Allow motion access or start the simulator to preview the full workflow on any device.";
        let sourceStatus = "Checking availability";
        let modeLabel = "Idle";
        let stateLabel = "Preparing";
        let bodyMode = "idle";

        if (state.recording) {
            headerStatus = "Recording live";
            headerVariant = "danger";
            sessionTitle = "Recording is active";
            sessionNote = "Streaming samples are being captured now. Stop the session to review and export the dataset.";
            sourceStatus = state.simRunning ? "Simulated source" : "Device sensors";
            modeLabel = "Recording";
            stateLabel = `${state.data.length} samples captured`;
            bodyMode = "recording";
        } else if (state.simRunning) {
            headerStatus = "Simulation active";
            headerVariant = "live";
            sessionTitle = "Simulation preview is running";
            sessionNote = "Synthetic motion data is driving the live chart so you can validate the complete workflow on desktop.";
            sourceStatus = state.sensorEnabled ? "Device + simulation" : "Simulated source";
            modeLabel = "Simulation";
            stateLabel = "Previewing motion";
            bodyMode = "simulation";
        } else if (state.sensorEnabled) {
            headerStatus = "Sensor ready";
            headerVariant = "live";
            sessionTitle = "Ready to capture";
            sessionNote = "Motion access is enabled. Start recording whenever you want to create a new dataset.";
            sourceStatus = "Device sensors";
            modeLabel = "Ready";
            stateLabel = "Awaiting capture";
            bodyMode = "ready";
        } else if (!els.permissionSection.hidden) {
            headerStatus = "Permission needed";
            headerVariant = "warning";
            sessionTitle = "Waiting for motion access";
            sessionNote = "Grant sensor permission to capture real accelerometer data on supported mobile browsers.";
            sourceStatus = "Awaiting permission";
            modeLabel = "Pending";
            stateLabel = "Permission required";
        } else if (!els.unsupportedSection.hidden) {
            headerStatus = "Motion unavailable";
            headerVariant = "warning";
            sessionTitle = "Use simulation mode";
            sessionNote = "This device or browser does not expose the accelerometer. The simulator lets you test every export flow anyway.";
            sourceStatus = "Unavailable";
            modeLabel = "Fallback";
            stateLabel = "Simulation available";
        }

        if (els.sensorStatus) {
            els.sensorStatus.textContent = headerStatus;
            setChipVariant(els.sensorStatus, headerVariant);
        }
        if (els.modeStatus) {
            els.modeStatus.textContent = modeLabel;
            setChipVariant(els.modeStatus, headerVariant === "danger" ? "danger" : headerVariant === "warning" ? "warning" : headerVariant === "live" ? "live" : "subtle");
        }
        if (els.sessionStatus) els.sessionStatus.textContent = sessionTitle;
        if (els.liveNote) els.liveNote.textContent = sessionNote;
        if (els.sourceStatus) els.sourceStatus.textContent = sourceStatus;
        if (els.stateStatus) els.stateStatus.textContent = stateLabel;
        document.body.dataset.mode = bodyMode;
    }

    // ---------- Controls ----------
    function updateControls() {
        const canRecord = state.sensorEnabled || state.simRunning;
        els.startBtn.hidden = !canRecord || state.recording;
        els.stopBtn.hidden = !state.recording;
        els.recordingBadge.hidden = !state.recording;
        updateStatusText();
        refreshDataSection();
    }

    function startRecording() {
        if (!(state.sensorEnabled || state.simRunning)) {
            showError("Enable motion access or start simulated data before recording.");
            return;
        }
        state.recording = true;
        state.data = [];
        state.startTime = performance.now();
        els.textarea.value = "";
        updateControls();
        clearNotice(true);
        scheduleRender();
    }

    function stopRecording() {
        state.recording = false;
        updateControls();

        if (state.data.length > 0) {
            els.textarea.value = JSON.stringify(state.data, null, 2);
        } else {
            els.textarea.value = "";
        }

        refreshDataSection();
        scheduleRender();
    }

    function clearData() {
        state.data = [];
        state.rolling = [];
        els.textarea.value = "";
        updateReadout(0, 0, 0, 0);
        updateStats();
        refreshDataSection();
        scheduleRender();
        clearNotice(true);
    }

    // ---------- Simulation ----------
    function toggleSim() {
        if (state.simRunning) stopSim();
        else startSim();
    }

    function startSim() {
        state.simRunning = true;
        state.simTime = 0;
        els.simBtn.textContent = "Stop simulation";
        els.simBtn.classList.add("active");

        state.simTimer = setInterval(() => {
            state.simTime += SIM_INTERVAL_MS;
            const t = state.simTime / 1000;
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

    // ---------- Stats + export state ----------
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

        if (state.recording) {
            if (els.stateStatus) els.stateStatus.textContent = `${state.data.length} samples captured`;
            if (els.dataSummary) {
                els.dataSummary.textContent = `${state.data.length} samples streaming · stop to prepare export`;
            }
        }
    }

    function parseEditorSamples() {
        const raw = els.textarea.value.trim();
        if (!raw) {
            return {
                hasText: false,
                valid: false,
                samples: state.data,
            };
        }

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return {
                    hasText: true,
                    valid: true,
                    samples: parsed,
                };
            }
        } catch (_) {
            // Ignore parse errors. The editor can remain free-form.
        }

        return {
            hasText: true,
            valid: false,
            samples: state.data,
        };
    }

    function getActiveSamples() {
        const parsed = parseEditorSamples();
        return parsed.valid ? parsed.samples : state.data;
    }

    function refreshDataSection() {
        const parsed = parseEditorSamples();
        const activeSamples = getActiveSamples();
        const hasRecordedData = state.data.length > 0;
        const canExport = !state.recording && activeSamples.length > 0;
        const canClear = !state.recording && (hasRecordedData || parsed.hasText);
        const showEmpty = state.recording || (!parsed.hasText && !hasRecordedData);

        els.copyBtn.disabled = !canExport;
        els.downloadJsonBtn.disabled = !canExport;
        els.downloadCsvBtn.disabled = !canExport;
        els.clearBtn.disabled = !canClear;

        els.dataSection.classList.toggle("is-empty", showEmpty);
        if (els.emptyState) els.emptyState.hidden = !showEmpty;

        if (state.recording) {
            els.dataSummary.textContent = `${state.data.length} samples streaming · stop to prepare export`;
            els.emptyStateTitle.textContent = "Recording in progress";
            els.emptyStateText.textContent = "Stop the current session to populate the editor with timestamped accelerometer samples.";
            return;
        }

        if (parsed.hasText && !parsed.valid) {
            els.dataSummary.textContent = hasRecordedData
                ? "Editor contains invalid JSON · exports will use the last recorded dataset"
                : "Editor contains invalid JSON";
            return;
        }

        if (parsed.valid) {
            els.dataSummary.textContent = `${parsed.samples.length} sample${parsed.samples.length === 1 ? "" : "s"} ready`;
            return;
        }

        els.dataSummary.textContent = "No samples recorded yet";
        els.emptyStateTitle.textContent = "Nothing captured yet";
        els.emptyStateText.textContent = "Start a recording or run the simulator to populate the editor with timestamped accelerometer samples.";
    }

    // ---------- Rendering ----------
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

        const palette = {
            grid: cssVar("--chart-grid"),
            axis: cssVar("--chart-axis"),
            x: cssVar("--chart-x"),
            y: cssVar("--chart-y"),
            z: cssVar("--chart-z"),
        };

        drawBackdrop(ctx, w, h, palette);

        const samples = state.rolling;
        if (samples.length < 2) {
            drawGrid(ctx, w, h, palette);
            return;
        }

        let maxAbs = 1;
        for (const s of samples) {
            maxAbs = Math.max(maxAbs, Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        }
        maxAbs = Math.max(2, Math.ceil(maxAbs * 1.15));

        drawGrid(ctx, w, h, palette);

        const xToPx = (i) => (i / (samples.length - 1)) * (w - 1);
        const yToPx = (v) => h / 2 - (v / maxAbs) * (h / 2 - 18);
        const baseline = h / 2;

        drawSeries(ctx, samples, "x", xToPx, yToPx, baseline, palette.x);
        drawSeries(ctx, samples, "y", xToPx, yToPx, baseline, palette.y);
        drawSeries(ctx, samples, "z", xToPx, yToPx, baseline, palette.z);
    }

    function drawBackdrop(ctx, w, h, palette) {
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, withAlpha(palette.axis, 0.08));
        gradient.addColorStop(1, withAlpha(palette.axis, 0.01));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    function drawGrid(ctx, w, h, palette) {
        ctx.save();
        ctx.strokeStyle = palette.grid;
        ctx.lineWidth = 1;

        const rows = 4;
        for (let i = 0; i <= rows; i++) {
            const y = (i / rows) * h;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const cols = 8;
        for (let i = 0; i <= cols; i++) {
            const x = (i / cols) * w;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        ctx.strokeStyle = palette.axis;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawSeries(ctx, samples, key, xToPx, yToPx, baseline, strokeColor) {
        if (!samples.length) return;

        ctx.save();

        const fillGradient = ctx.createLinearGradient(0, 0, 0, baseline + 70);
        fillGradient.addColorStop(0, withAlpha(strokeColor, 0.18));
        fillGradient.addColorStop(1, withAlpha(strokeColor, 0));

        ctx.beginPath();
        for (let i = 0; i < samples.length; i++) {
            const x = xToPx(i);
            const y = yToPx(samples[i][key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(xToPx(samples.length - 1), baseline);
        ctx.lineTo(xToPx(0), baseline);
        ctx.closePath();
        ctx.fillStyle = fillGradient;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < samples.length; i++) {
            const x = xToPx(i);
            const y = yToPx(samples[i][key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        const last = samples[samples.length - 1];
        const endX = xToPx(samples.length - 1);
        const endY = yToPx(last[key]);
        ctx.beginPath();
        ctx.fillStyle = strokeColor;
        ctx.arc(endX, endY, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // ---------- Export ----------
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
        } catch (_) {
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
        } catch (_) {
            ok = false;
        }

        document.body.removeChild(ta);
        if (ok) {
            flashSuccess("Copied JSON to clipboard.");
        } else {
            showError("Could not copy to clipboard — select the text manually.");
        }
    }

    // ---------- Navigation + motion polish ----------
    function bindScrollState() {
        const onScroll = () => {
            document.body.classList.toggle("is-scrolled", window.scrollY > 12);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    }

    function setActiveNav(id) {
        els.navLinks.forEach((link) => {
            const isActive = link.getAttribute("href") === `#${id}`;
            link.classList.toggle("is-active", isActive);
        });
    }

    function bindSectionTracking() {
        if (!els.navLinks.length || !els.navSections.length) return;

        if (!("IntersectionObserver" in window)) {
            setActiveNav(els.navSections[0].id);
            return;
        }

        state.navObserver = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (visible) {
                setActiveNav(visible.target.id);
            }
        }, {
            rootMargin: "-25% 0px -50% 0px",
            threshold: [0.2, 0.45, 0.7],
        });

        els.navSections.forEach((section) => state.navObserver.observe(section));
    }

    function bindRevealAnimations() {
        if (state.prefersReducedMotion || !("IntersectionObserver" in window)) {
            els.revealNodes.forEach((node) => node.classList.add("is-visible"));
            return;
        }

        state.revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                state.revealObserver.unobserve(entry.target);
            });
        }, {
            rootMargin: "0px 0px -10% 0px",
            threshold: 0.18,
        });

        els.revealNodes.forEach((node) => state.revealObserver.observe(node));
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
        els.textarea.addEventListener("input", refreshDataSection);
        window.addEventListener("resize", scheduleRender);

        if (window.matchMedia) {
            const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
            if (typeof colorScheme.addEventListener === "function") {
                colorScheme.addEventListener("change", scheduleRender);
            } else if (typeof colorScheme.addListener === "function") {
                colorScheme.addListener(scheduleRender);
            }
        }
    }

    // ---------- Init ----------
    function init() {
        bindEvents();
        bindScrollState();
        bindSectionTracking();
        bindRevealAnimations();

        if (typeof window.DeviceMotionEvent === "undefined") {
            showUnsupported("This browser does not support the DeviceMotion API. Use the simulated data above.");
        } else if (typeof DeviceMotionEvent.requestPermission === "function") {
            showPermission();
        } else {
            enableSensor();
        }

        updateReadout(0, 0, 0, 0);
        updateControls();
        refreshDataSection();
        requestAnimationFrame(renderChart);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
