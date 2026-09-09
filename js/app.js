/* =========================================================================
   Accelerometer — application logic
   -------------------------------------------------------------------------
   Reads the DeviceMotion API, visualises live X/Y/Z, records samples and
   exports data as JSON or CSV. No external dependencies.

   Presentation concerns (theme, popovers, dialogs, nav indicator, reveals)
   live in js/ui.js and are reached through the optional `window.AccUI`
   facade, so this file keeps working even if that layer is unavailable.
   ========================================================================= */

(function () {
    "use strict";

    var UI = window.AccUI || null;

    // ---------- DOM references ----------
    var el = function (id) { return document.getElementById(id); };

    var els = {
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
        editorState: el("editorState"),
        emptyState: el("emptyState"),
        emptyStateTitle: el("emptyStateTitle"),
        emptyStateText: el("emptyStateText"),
        textarea: el("textarea"),
        formatBtn: el("formatBtn"),
        copyBtn: el("copyBtn"),
        downloadJsonBtn: el("downloadJsonBtn"),
        downloadCsvBtn: el("downloadCsvBtn"),
        clearBtn: el("clearBtn"),
        err: el("err"),
        navLinks: Array.prototype.slice.call(document.querySelectorAll(".nav-link")),
        navSections: Array.prototype.slice.call(document.querySelectorAll("[data-nav-section]")),
        chartFigure: document.querySelector("[data-chart]"),
        chartTip: document.querySelector("[data-chart-tip]"),
        legendButtons: Array.prototype.slice.call(document.querySelectorAll("[data-series]")),
        emptyAction: document.querySelector("[data-empty-action]"),
        toastMsg: document.querySelector("[data-toast-msg]"),
        toastIconUse: document.querySelector("[data-toast-icon] use"),
        toastAction: document.querySelector("[data-toast-action]"),
        toastClose: document.querySelector("[data-toast-close]")
    };

    // ---------- State ----------
    var state = {
        sensorEnabled: false,
        simRunning: false,
        recording: false,
        uiMode: "checking",   // checking | permission | unsupported | ready
        data: [],
        rolling: [],
        rollingOrigin: 0,
        startTime: 0,
        simTime: 0,
        simTimer: null,
        rafId: null,
        lastX: 0,
        lastY: 0,
        lastZ: 0,
        series: { x: true, y: true, z: true },
        hoverIndex: null,
        chartGeom: null,
        palette: null,
        noticeTimer: null,
        hideNoticeTimer: null,
        noticeAction: null,
        revealObserver: null,
        navObserver: null,
        prefersReducedMotion: prefersReducedMotion()
    };

    var MAX_ROLLING = 600;
    var SIM_INTERVAL_MS = 16;
    var NOTICE_SUCCESS_MS = 2400;

    // ---------- Helpers ----------
    function prefersReducedMotion() {
        if (UI && typeof UI.reducedMotion === "function") return UI.reducedMotion();
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function format(n, digits) {
        if (digits === undefined) digits = 2;
        if (!Number.isFinite(n)) return Number(0).toFixed(digits);
        return Number(n).toFixed(digits);
    }

    function numberOr(v, fallback) {
        if (fallback === undefined) fallback = 0;
        return (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
    }

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function hexToRgb(hex) {
        var value = String(hex || "").replace("#", "").trim();
        if (value.length !== 6) return null;
        var num = Number.parseInt(value, 16);
        if (!Number.isFinite(num)) return null;
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    function withAlpha(color, alpha) {
        if (!color) return "rgba(140, 150, 170, " + alpha + ")";
        if (color.indexOf("rgba(") === 0) {
            return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgba($1,$2,$3," + alpha + ")");
        }
        if (color.indexOf("rgb(") === 0) {
            return color.replace(/rgb\(([^,]+),([^,]+),([^,]+)\)/, "rgba($1,$2,$3," + alpha + ")");
        }
        if (color.charAt(0) === "#") {
            var rgb = hexToRgb(color);
            if (rgb) return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
        }
        return color;
    }

    /* Show/hide with a short crossfade instead of snapping.
       Both directions are idempotent: `updateStats` re-asserts the stats panel
       on every animation frame, so a repeated "hide" must not keep resetting
       its own timer (that would leave the element stuck mid-fade, still in the
       accessibility tree) and a repeated "show" must not restart the intro. */
    function setVisible(node, visible) {
        if (!node) return;

        if (visible) {
            if (node.__hideTimer) {
                clearTimeout(node.__hideTimer);
                node.__hideTimer = null;
            }
            node.classList.remove("is-leaving");
            if (!node.hidden) return;
            node.hidden = false;
            if (UI) UI.markEntering(node);
            return;
        }

        if (node.hidden || node.__hideTimer) return;
        if (!UI || prefersReducedMotion()) {
            node.hidden = true;
            return;
        }
        node.classList.add("is-leaving");
        node.__hideTimer = setTimeout(function () {
            node.hidden = true;
            node.classList.remove("is-leaving");
            node.__hideTimer = null;
        }, 180);
    }

    function setChipVariant(node, variant) {
        if (!node) return;
        node.classList.remove("chip--live", "chip--success", "chip--warning", "chip--danger", "chip--quiet");
        node.classList.add("chip--" + variant);
    }

    /* Success morph: the button icon becomes a self-drawing checkmark. */
    function markDone(node) {
        if (!node || !node.classList.contains("btn")) return;
        node.classList.add("is-done");
        clearTimeout(node.__doneTimer);
        node.__doneTimer = setTimeout(function () {
            node.classList.remove("is-done");
        }, 1400);
    }

    // ---------- Notifications (layer 6) ----------
    function setNotice(message, type, action) {
        clearTimeout(state.noticeTimer);
        clearTimeout(state.hideNoticeTimer);
        if (!els.err) return;

        var isError = type === "error";
        els.err.hidden = false;
        els.err.classList.remove("is-visible");
        els.err.setAttribute("data-variant", isError ? "error" : "success");
        els.err.setAttribute("role", isError ? "alert" : "status");
        els.err.setAttribute("aria-live", isError ? "assertive" : "polite");

        if (els.toastMsg) els.toastMsg.textContent = message;
        if (els.toastIconUse) {
            els.toastIconUse.setAttribute("href", isError ? "#i-alert" : "#i-check");
        }

        state.noticeAction = action || null;
        if (els.toastAction) {
            if (state.noticeAction) {
                els.toastAction.hidden = false;
                els.toastAction.textContent = state.noticeAction.label;
            } else {
                els.toastAction.hidden = true;
                els.toastAction.textContent = "";
            }
        }

        requestAnimationFrame(function () {
            els.err.classList.add("is-visible");
        });
    }

    function showError(message) {
        setNotice(message, "error");
    }

    function showSuccess(message, action) {
        setNotice(message, "success", action);
    }

    function clearNotice(immediate) {
        clearTimeout(state.noticeTimer);
        clearTimeout(state.hideNoticeTimer);
        if (!els.err || els.err.hidden) return;

        els.err.classList.remove("is-visible");
        state.noticeAction = null;

        var hide = function () {
            els.err.hidden = true;
            if (els.toastMsg) els.toastMsg.textContent = "";
            if (els.toastAction) {
                els.toastAction.hidden = true;
                els.toastAction.textContent = "";
            }
        };

        if (immediate || prefersReducedMotion()) {
            hide();
            return;
        }
        state.hideNoticeTimer = setTimeout(hide, 220);
    }

    function flashSuccess(message, action) {
        showSuccess(message, action);
        state.noticeTimer = setTimeout(function () { clearNotice(false); }, NOTICE_SUCCESS_MS);
    }

    // ---------- Readouts ----------
    function setReadoutLevel(node, value, maxAbs) {
        if (!node) return;
        var normalized = Math.max(0, Math.min(Math.abs(numberOr(value)) / maxAbs, 1));
        node.style.setProperty("--level", normalized.toFixed(3));
    }

    // ---------- Sample processing ----------
    function processSample(accel) {
        var x = numberOr(accel.x);
        var y = numberOr(accel.y);
        var z = numberOr(accel.z);
        var mag = Math.hypot(x, y, z);

        state.lastX = x;
        state.lastY = y;
        state.lastZ = z;

        updateReadout(x, y, z, mag);

        if (!state.rolling.length) state.rollingOrigin = performance.now();
        state.rolling.push({ t: performance.now() - state.rollingOrigin, x: x, y: y, z: z });
        if (state.rolling.length > MAX_ROLLING) {
            state.rolling.splice(0, state.rolling.length - MAX_ROLLING);
        }

        if (state.recording) {
            var t = performance.now() - state.startTime;
            state.data.push({ t: t, x: x, y: y, z: z, mag: mag });
        }

        if (els.chartFigure) els.chartFigure.setAttribute("data-state", "live");
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
        var a = e.accelerationIncludingGravity || e.acceleration || {};
        processSample({ x: a.x, y: a.y, z: a.z });
    }

    function enableSensor() {
        state.sensorEnabled = true;
        state.uiMode = "ready";
        setVisible(els.permissionSection, false);
        setVisible(els.unsupportedSection, false);
        if (typeof window.DeviceMotionEvent !== "undefined") {
            window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
        }
        updateControls();
        refreshDataSection();
        clearNotice(true);
    }

    function requestPermission() {
        return Promise.resolve(DeviceMotionEvent.requestPermission())
            .then(function (permission) {
                if (permission === "granted") {
                    enableSensor();
                } else {
                    showUnsupported("Motion sensor permission was denied. Enable it in your browser settings and reload.");
                }
            })
            .catch(function (err) {
                showUnsupported("Could not request motion permission: " + ((err && err.message) || "unknown error") + ".");
            });
    }

    function showPermission() {
        state.uiMode = "permission";
        setVisible(els.permissionSection, true);
        setVisible(els.unsupportedSection, false);
        updateControls();
        refreshDataSection();
    }

    function showUnsupported(note) {
        state.uiMode = "unsupported";
        if (els.unsupportedNote) {
            els.unsupportedNote.textContent = note || "Motion sensors are not available on this device.";
        }
        setVisible(els.unsupportedSection, true);
        setVisible(els.permissionSection, false);
        updateControls();
        refreshDataSection();
    }

    // ---------- UI status ----------
    function updateStatusText() {
        var headerStatus = "Checking sensors";
        var headerVariant = "quiet";
        var sessionTitle = "Preparing workspace";
        var sessionNote = "Allow motion access or start the simulator to preview the full workflow on any device.";
        var sourceStatus = "Checking availability";
        var modeLabel = "Idle";
        var stateLabel = "Preparing";
        var bodyMode = "idle";

        if (state.recording) {
            headerStatus = "Recording live";
            headerVariant = "danger";
            sessionTitle = "Recording is active";
            sessionNote = "Streaming samples are being captured now. Stop the session to review and export the dataset.";
            sourceStatus = state.simRunning ? "Simulated source" : "Device sensors";
            modeLabel = "Recording";
            stateLabel = state.data.length + " samples captured";
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
            headerVariant = "success";
            sessionTitle = "Ready to capture";
            sessionNote = "Motion access is enabled. Start recording whenever you want to create a new dataset.";
            sourceStatus = "Device sensors";
            modeLabel = "Ready";
            stateLabel = "Awaiting capture";
            bodyMode = "ready";
        } else if (state.uiMode === "permission") {
            headerStatus = "Permission needed";
            headerVariant = "warning";
            sessionTitle = "Waiting for motion access";
            sessionNote = "Grant sensor permission to capture real accelerometer data on supported mobile browsers.";
            sourceStatus = "Awaiting permission";
            modeLabel = "Pending";
            stateLabel = "Permission required";
        } else if (state.uiMode === "unsupported") {
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
            setChipVariant(els.modeStatus, headerVariant === "danger" ? "danger"
                : headerVariant === "warning" ? "warning"
                    : headerVariant === "live" ? "live" : "quiet");
        }
        if (els.sessionStatus) els.sessionStatus.textContent = sessionTitle;
        if (els.liveNote) els.liveNote.textContent = sessionNote;
        if (els.sourceStatus) els.sourceStatus.textContent = sourceStatus;
        if (els.stateStatus) els.stateStatus.textContent = stateLabel;
        document.body.dataset.mode = bodyMode;
    }

    // ---------- Controls ----------
    function updateControls() {
        var canRecord = state.sensorEnabled || state.simRunning;
        setVisible(els.startBtn, canRecord && !state.recording);
        setVisible(els.stopBtn, state.recording);
        setVisible(els.recordingBadge, state.recording);
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

        els.textarea.value = state.data.length > 0 ? JSON.stringify(state.data, null, 2) : "";

        refreshDataSection();
        scheduleRender();
    }

    function clearData() {
        state.data = [];
        state.rolling = [];
        state.rollingOrigin = 0;
        state.hoverIndex = null;
        els.textarea.value = "";
        updateReadout(0, 0, 0, 0);
        updateStats();
        refreshDataSection();
        if (els.chartFigure) els.chartFigure.setAttribute("data-state", "idle");
        scheduleRender();
        clearNotice(true);
    }

    function confirmClear() {
        if (UI && UI.dialog && UI.dialog.el) {
            UI.dialog.open();
            return;
        }
        // Fallback when the presentation layer is unavailable.
        if (window.confirm("Clear the recorded samples and editor contents?")) clearData();
    }

    // ---------- Simulation ----------
    function toggleSim() {
        if (state.simRunning) stopSim();
        else startSim();
    }

    function startSim() {
        state.simRunning = true;
        state.simTime = 0;
        els.simBtn.setAttribute("aria-pressed", "true");
        setSimLabel("Stop simulation");

        state.simTimer = setInterval(function () {
            state.simTime += SIM_INTERVAL_MS;
            var t = state.simTime / 1000;
            var x = Math.sin(2 * Math.PI * 0.5 * t) * 2.5;
            var y = Math.cos(2 * Math.PI * 0.5 * t) * 2.5;
            var z = Math.sin(2 * Math.PI * 0.2 * t) * 3 + 9.8;
            processSample({ x: x, y: y, z: z });
        }, SIM_INTERVAL_MS);

        updateControls();
    }

    function stopSim() {
        clearInterval(state.simTimer);
        state.simTimer = null;
        state.simRunning = false;
        els.simBtn.setAttribute("aria-pressed", "false");
        setSimLabel("Simulate data");
        updateControls();
    }

    function setSimLabel(label) {
        var text = els.simBtn.querySelector(".btn__label");
        if (text) text.textContent = label;
        else els.simBtn.textContent = label;
    }

    // ---------- Stats + export state ----------
    function updateStats() {
        var hasData = state.recording || state.data.length > 0;
        setVisible(els.stats, hasData);
        if (!hasData) return;

        var durationMs;
        if (state.recording) {
            durationMs = performance.now() - state.startTime;
        } else {
            var last = state.data[state.data.length - 1];
            durationMs = last ? last.t : 0;
        }

        var seconds = durationMs / 1000;
        var rate = seconds > 0 ? state.data.length / seconds : 0;

        els.statCount.textContent = String(state.data.length);
        els.statDuration.textContent = format(seconds, 1) + "s";
        els.statRate.textContent = Math.round(rate) + " Hz";

        if (state.recording) {
            if (els.stateStatus) els.stateStatus.textContent = state.data.length + " samples captured";
            if (els.dataSummary) {
                els.dataSummary.textContent = state.data.length + " samples streaming · stop to prepare export";
            }
        }
    }

    function parseEditorSamples() {
        var raw = els.textarea.value.trim();
        if (!raw) {
            return { hasText: false, valid: false, samples: state.data };
        }

        try {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return { hasText: true, valid: true, samples: parsed };
            }
        } catch (err) {
            // Ignore parse errors — the editor is allowed to be mid-edit.
        }

        return { hasText: true, valid: false, samples: state.data };
    }

    function getActiveSamples() {
        var parsed = parseEditorSamples();
        return parsed.valid ? parsed.samples : state.data;
    }

    function refreshDataSection() {
        var parsed = parseEditorSamples();
        var activeSamples = getActiveSamples();
        var hasRecordedData = state.data.length > 0;
        var canExport = !state.recording && activeSamples.length > 0;
        var canClear = !state.recording && (hasRecordedData || parsed.hasText);
        var showEmpty = state.recording || (!parsed.hasText && !hasRecordedData);

        els.copyBtn.disabled = !canExport;
        els.downloadJsonBtn.disabled = !canExport;
        els.downloadCsvBtn.disabled = !canExport;
        els.clearBtn.disabled = !canClear;
        if (els.formatBtn) els.formatBtn.disabled = !(parsed.hasText && parsed.valid);

        els.dataSection.classList.toggle("is-empty", showEmpty);
        setVisible(els.emptyState, showEmpty);

        if (state.recording) {
            setEditorState("recording", "Recording", state.data.length + " samples streaming · stop to prepare export");
            els.emptyStateTitle.textContent = "Recording in progress";
            els.emptyStateText.textContent = "Stop the current session to populate the editor with timestamped accelerometer samples.";
            return;
        }

        if (parsed.hasText && !parsed.valid) {
            setEditorState("invalid", "Invalid JSON", hasRecordedData
                ? "Editor contains invalid JSON · exports will use the last recorded dataset"
                : "Editor contains invalid JSON");
            return;
        }

        if (parsed.valid) {
            setEditorState("ready", parsed.samples.length + (parsed.samples.length === 1 ? " sample" : " samples"),
                parsed.samples.length + " sample" + (parsed.samples.length === 1 ? "" : "s") + " ready");
            return;
        }

        setEditorState("empty", "Empty", "No samples recorded yet");
        els.emptyStateTitle.textContent = "Nothing captured yet";
        els.emptyStateText.textContent = "Start a recording or run the simulator to populate the editor with timestamped accelerometer samples.";
    }

    function setEditorState(kind, chipLabel, summary) {
        if (els.dataSection) els.dataSection.setAttribute("data-state", kind);
        if (els.dataSummary) els.dataSummary.textContent = summary;
        if (els.editorState) {
            els.editorState.textContent = chipLabel;
            setChipVariant(els.editorState, kind === "ready" ? "success"
                : kind === "invalid" ? "danger"
                    : kind === "recording" ? "danger" : "quiet");
        }
    }

    function formatEditor() {
        var parsed = parseEditorSamples();
        if (!parsed.hasText || !parsed.valid) {
            showError("The editor does not contain a valid JSON array yet.");
            return;
        }
        els.textarea.value = JSON.stringify(parsed.samples, null, 2);
        refreshDataSection();
        markDone(els.formatBtn);
        flashSuccess("Formatted " + parsed.samples.length + " samples.");
    }

    // ---------- Rendering ----------
    function scheduleRender() {
        if (state.rafId !== null) return;
        state.rafId = requestAnimationFrame(function () {
            state.rafId = null;
            renderChart();
            updateStats();
        });
    }

    function chartPalette() {
        if (!state.palette) {
            state.palette = {
                grid: cssVar("--chart-grid"),
                axis: cssVar("--chart-axis"),
                label: cssVar("--chart-label"),
                cursor: cssVar("--chart-cursor"),
                x: cssVar("--series-x"),
                y: cssVar("--series-y"),
                z: cssVar("--series-z"),
                font: cssVar("--font-sans").split(",")[0].replace(/["']/g, "")
            };
        }
        return state.palette;
    }

    function invalidatePalette() {
        state.palette = null;
        scheduleRender();
    }

    function activeSeriesKeys() {
        return ["x", "y", "z"].filter(function (key) { return state.series[key]; });
    }

    function renderChart() {
        var canvas = els.chart;
        if (!canvas) return;
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        var w = rect.width;
        var h = rect.height;
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
        }

        var ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        var palette = chartPalette();
        var samples = state.rolling;
        var keys = activeSeriesKeys();

        var maxAbs = 1;
        var i;
        for (i = 0; i < samples.length; i++) {
            for (var k = 0; k < keys.length; k++) {
                maxAbs = Math.max(maxAbs, Math.abs(samples[i][keys[k]]));
            }
        }
        maxAbs = Math.max(2, Math.ceil(maxAbs * 1.15));

        var geom = {
            w: w,
            h: h,
            maxAbs: maxAbs,
            samples: samples,
            xToPx: function (index) {
                return samples.length > 1 ? (index / (samples.length - 1)) * (w - 1) : w / 2;
            },
            yToPx: function (value) {
                return h / 2 - (value / maxAbs) * (h / 2 - 20);
            }
        };
        state.chartGeom = geom;

        drawPlotBackground(ctx, w, h, palette);
        drawGrid(ctx, geom, palette);

        if (samples.length < 2 || !keys.length) {
            hideTip();
            return;
        }

        var colors = { x: palette.x, y: palette.y, z: palette.z };
        keys.forEach(function (key) {
            drawSeries(ctx, geom, key, colors[key]);
        });

        if (state.hoverIndex !== null) {
            drawCursor(ctx, geom, palette);
            updateTip(geom);
        } else {
            hideTip();
        }
    }

    function drawPlotBackground(ctx, w, h, palette) {
        var gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, withAlpha(palette.axis, 0.07));
        gradient.addColorStop(1, withAlpha(palette.axis, 0.01));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    function drawGrid(ctx, geom, palette) {
        var w = geom.w;
        var h = geom.h;
        var rows = 4;
        var cols = 8;
        var i;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = palette.grid;

        for (i = 0; i <= rows; i++) {
            var y = Math.round((i / rows) * h) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        for (i = 1; i < cols; i++) {
            var x = Math.round((i / cols) * w) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Zero line reads stronger than the rest of the grid.
        ctx.strokeStyle = palette.axis;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(h / 2) + 0.5);
        ctx.lineTo(w, Math.round(h / 2) + 0.5);
        ctx.stroke();

        ctx.fillStyle = palette.label;
        ctx.font = "500 10px " + palette.font + ", sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText("+" + geom.maxAbs, 8, geom.yToPx(geom.maxAbs) + 1);
        ctx.fillText("0", 8, h / 2 - 8);
        ctx.fillText("−" + geom.maxAbs, 8, geom.yToPx(-geom.maxAbs) - 1);
        ctx.restore();
    }

    function drawSeries(ctx, geom, key, strokeColor) {
        var samples = geom.samples;
        if (!samples.length) return;

        var baseline = geom.h / 2;
        var i;
        var x;
        var y;

        ctx.save();

        var fillGradient = ctx.createLinearGradient(0, 0, 0, baseline + 70);
        fillGradient.addColorStop(0, withAlpha(strokeColor, 0.16));
        fillGradient.addColorStop(1, withAlpha(strokeColor, 0));

        ctx.beginPath();
        for (i = 0; i < samples.length; i++) {
            x = geom.xToPx(i);
            y = geom.yToPx(samples[i][key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(geom.xToPx(samples.length - 1), baseline);
        ctx.lineTo(geom.xToPx(0), baseline);
        ctx.closePath();
        ctx.fillStyle = fillGradient;
        ctx.fill();

        ctx.beginPath();
        for (i = 0; i < samples.length; i++) {
            x = geom.xToPx(i);
            y = geom.yToPx(samples[i][key]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // Leading marker with a soft halo, so the newest sample is obvious.
        var last = samples[samples.length - 1];
        var endX = geom.xToPx(samples.length - 1);
        var endY = geom.yToPx(last[key]);

        ctx.beginPath();
        ctx.fillStyle = withAlpha(strokeColor, 0.22);
        ctx.arc(endX, endY, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = strokeColor;
        ctx.arc(endX, endY, 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawCursor(ctx, geom, palette) {
        var index = clampIndex(state.hoverIndex);
        if (index === null) return;
        var x = Math.round(geom.xToPx(index)) + 0.5;

        ctx.save();
        ctx.strokeStyle = palette.cursor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, geom.h);
        ctx.stroke();
        ctx.setLineDash([]);

        var sample = geom.samples[index];
        var colors = { x: palette.x, y: palette.y, z: palette.z };
        Object.keys(colors).forEach(function (key) {
            if (!state.series[key]) return;
            ctx.beginPath();
            ctx.fillStyle = colors[key];
            ctx.arc(x, geom.yToPx(sample[key]), 3.2, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function clampIndex(index) {
        var count = state.rolling.length;
        if (!count || index === null || index === undefined) return null;
        return Math.max(0, Math.min(count - 1, index));
    }

    function updateTip(geom) {
        var tip = els.chartTip;
        if (!tip) return;
        var index = clampIndex(state.hoverIndex);
        if (index === null) {
            hideTip();
            return;
        }

        var sample = state.rolling[index];
        tip.hidden = false;

        var time = tip.querySelector("[data-tip-time]");
        if (time) time.textContent = "+" + format((sample.t || 0) / 1000, 2) + "s";

        ["x", "y", "z"].forEach(function (key) {
            var row = tip.querySelector("[data-tip-row='" + key + "']");
            if (!row) return;
            row.hidden = !state.series[key];
            var value = tip.querySelector("[data-tip-value='" + key + "']");
            if (value) value.textContent = format(sample[key]);
        });

        var px = geom.xToPx(index);
        var tipW = tip.offsetWidth || 140;
        var tipH = tip.offsetHeight || 84;
        var left = px + 14;
        if (left + tipW > geom.w - 6) left = px - tipW - 14;
        left = Math.max(6, Math.min(left, Math.max(6, geom.w - tipW - 6)));
        var top = Math.max(6, Math.min(geom.yToPx(sample.z) - tipH / 2, geom.h - tipH - 6));

        tip.style.setProperty("--tip-x", left.toFixed(1) + "px");
        tip.style.setProperty("--tip-y", top.toFixed(1) + "px");
        tip.classList.add("is-visible");
    }

    function hideTip() {
        if (!els.chartTip) return;
        els.chartTip.classList.remove("is-visible");
        if (prefersReducedMotion()) els.chartTip.hidden = true;
    }

    function setHoverFromClientX(clientX) {
        var geom = state.chartGeom;
        if (!geom || !state.rolling.length) return;
        var rect = els.chart.getBoundingClientRect();
        var ratio = (clientX - rect.left) / rect.width;
        state.hoverIndex = clampIndex(Math.round(ratio * (state.rolling.length - 1)));
        scheduleRender();
    }

    function moveHover(delta) {
        if (!state.rolling.length) return;
        var current = state.hoverIndex === null ? state.rolling.length - 1 : state.hoverIndex;
        state.hoverIndex = clampIndex(current + delta);
        scheduleRender();
    }

    // ---------- Export ----------
    function samplesToCsv(samples) {
        var header = "time,x,y,z,magnitude";
        var rows = samples.map(function (s) {
            var t = (s && s.t != null) ? s.t : "";
            var x = (s && s.x != null) ? s.x : "";
            var y = (s && s.y != null) ? s.y : "";
            var z = (s && s.z != null) ? s.z : "";
            var mag = (s && s.mag != null) ? s.mag : "";
            return [t, x, y, z, mag].map(cellToCsv).join(",");
        });
        return [header].concat(rows).join("\n");
    }

    function cellToCsv(value) {
        var v = (value == null) ? "" : String(value);
        if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
        return v;
    }

    function fileName(prefix, ext) {
        var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        return prefix + "-" + stamp + "." + ext;
    }

    function downloadBlob(content, mime, name) {
        var blob = new Blob([content], { type: mime });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function downloadCsv() {
        var samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to download yet.");
            return;
        }
        downloadBlob(samplesToCsv(samples), "text/csv;charset=utf-8;", fileName("accelerometer", "csv"));
        markDone(els.downloadCsvBtn);
        flashSuccess("Downloaded " + samples.length + " samples as CSV.");
    }

    function downloadJson() {
        var samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to download yet.");
            return;
        }
        downloadBlob(JSON.stringify(samples, null, 2), "application/json;charset=utf-8;", fileName("accelerometer", "json"));
        markDone(els.downloadJsonBtn);
        flashSuccess("Downloaded " + samples.length + " samples as JSON.");
    }

    function copyData() {
        var samples = getActiveSamples();
        if (samples.length === 0) {
            showError("No data to copy yet.");
            return;
        }
        var text = JSON.stringify(samples, null, 2);

        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
            fallbackCopy(text, samples.length);
            return;
        }

        navigator.clipboard.writeText(text).then(function () {
            markDone(els.copyBtn);
            flashSuccess("Copied " + samples.length + " samples to the clipboard.", {
                label: "Download",
                run: downloadJson
            });
        }).catch(function () {
            fallbackCopy(text, samples.length);
        });
    }

    function fallbackCopy(text, count) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.focus();
        ta.select();

        var ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (err) {
            ok = false;
        }

        document.body.removeChild(ta);
        if (ok) {
            markDone(els.copyBtn);
            flashSuccess("Copied " + (count || 0) + " samples to the clipboard.");
        } else {
            showError("Could not copy to clipboard — select the text manually.");
        }
    }

    // ---------- Navigation tracking ----------
    function bindScrollState() {
        // Only used when js/ui.js is absent; otherwise the UI layer owns this.
        var onScroll = function () {
            document.body.classList.toggle("is-scrolled", window.scrollY > 10);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    }

    function setActiveNav(id) {
        els.navLinks.forEach(function (link) {
            var isActive = link.getAttribute("href") === "#" + id;
            link.classList.toggle("is-active", isActive);
            if (isActive) link.setAttribute("aria-current", "true");
            else link.removeAttribute("aria-current");
        });
        if (UI && typeof UI.refreshIndicators === "function") UI.refreshIndicators();
    }

    function bindSectionTracking() {
        if (!els.navLinks.length || !els.navSections.length) return;

        if (!("IntersectionObserver" in window)) {
            setActiveNav(els.navSections[0].id);
            return;
        }

        state.navObserver = new IntersectionObserver(function (entries) {
            var visible = entries
                .filter(function (entry) { return entry.isIntersecting; })
                .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];

            if (visible) setActiveNav(visible.target.id);
        }, {
            rootMargin: "-25% 0px -50% 0px",
            threshold: [0.2, 0.45, 0.7]
        });

        els.navSections.forEach(function (section) { state.navObserver.observe(section); });
    }

    function bindRevealAnimations() {
        // js/ui.js owns reveals when present (it also staggers siblings).
        if (UI) return;

        var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
        if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
            nodes.forEach(function (node) { node.classList.add("is-visible"); });
            return;
        }

        state.revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                state.revealObserver.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -10% 0px", threshold: 0.18 });

        nodes.forEach(function (node) { state.revealObserver.observe(node); });
    }

    // ---------- Binding ----------
    function bindEvents() {
        els.permissionBtn.addEventListener("click", requestPermission);
        els.startBtn.addEventListener("click", startRecording);
        els.stopBtn.addEventListener("click", stopRecording);
        els.clearBtn.addEventListener("click", confirmClear);
        els.copyBtn.addEventListener("click", copyData);
        els.downloadJsonBtn.addEventListener("click", downloadJson);
        els.downloadCsvBtn.addEventListener("click", downloadCsv);
        els.simBtn.addEventListener("click", toggleSim);
        els.textarea.addEventListener("input", refreshDataSection);
        window.addEventListener("resize", scheduleRender);

        if (els.formatBtn) els.formatBtn.addEventListener("click", formatEditor);

        if (els.emptyAction) els.emptyAction.addEventListener("click", toggleSim);

        els.legendButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                var key = button.getAttribute("data-series");
                if (!state.series.hasOwnProperty(key)) return;
                state.series[key] = !state.series[key];
                button.setAttribute("aria-pressed", state.series[key] ? "true" : "false");
                scheduleRender();
            });
        });

        if (els.chart) {
            els.chart.addEventListener("pointermove", function (event) {
                if (event.pointerType === "touch") return;
                setHoverFromClientX(event.clientX);
            });
            els.chart.addEventListener("pointerleave", function () {
                state.hoverIndex = null;
                scheduleRender();
            });
            els.chart.addEventListener("blur", function () {
                state.hoverIndex = null;
                scheduleRender();
            });
            els.chart.addEventListener("keydown", function (event) {
                var step = event.shiftKey ? 10 : 1;
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    moveHover(step);
                } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveHover(-step);
                } else if (event.key === "Home") {
                    event.preventDefault();
                    state.hoverIndex = 0;
                    scheduleRender();
                } else if (event.key === "End") {
                    event.preventDefault();
                    state.hoverIndex = state.rolling.length - 1;
                    scheduleRender();
                } else if (event.key === "Escape") {
                    state.hoverIndex = null;
                    scheduleRender();
                }
            });
        }

        if (els.toastClose) {
            els.toastClose.addEventListener("click", function () { clearNotice(false); });
        }

        if (els.toastAction) {
            els.toastAction.addEventListener("click", function () {
                var action = state.noticeAction;
                clearNotice(false);
                if (action && typeof action.run === "function") action.run();
            });
        }

        if (UI && typeof UI.onThemeChange === "function") {
            UI.onThemeChange(invalidatePalette);
        } else if (window.matchMedia) {
            var colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
            if (typeof colorScheme.addEventListener === "function") {
                colorScheme.addEventListener("change", invalidatePalette);
            } else if (typeof colorScheme.addListener === "function") {
                colorScheme.addListener(invalidatePalette);
            }
        }
    }

    // ---------- Init ----------
    function init() {
        if (UI && UI.dialog && typeof UI.dialog.init === "function") {
            UI.dialog.init(clearData);
        }

        bindEvents();
        if (!UI) bindScrollState();
        bindSectionTracking();
        bindRevealAnimations();

        if (typeof window.DeviceMotionEvent === "undefined") {
            showUnsupported("This browser does not support the DeviceMotion API. Use the simulated data above.");
        } else if (typeof DeviceMotionEvent.requestPermission === "function") {
            showPermission();
        } else {
            enableSensor();
        }

        if (els.chartFigure) els.chartFigure.setAttribute("data-state", "idle");
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
