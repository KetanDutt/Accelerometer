#!/usr/bin/env node
/* =========================================================================
   verify-flows.js — functional smoke test for the Accelerometer UI
   -------------------------------------------------------------------------
   Boots the real index.html in a DOM and drives the real user flows against
   the real js/ui.js and js/app.js. Nothing about the application code is
   mocked: only the browser back-ends jsdom does not implement are stubbed
   (canvas 2D context, element geometry, object URLs, clipboard).

   Dev-only. Requires jsdom, which is deliberately NOT a project dependency:

       npm install --no-save jsdom
       node scripts/verify-flows.js

   (or: NODE_PATH=/path/to/node_modules node scripts/verify-flows.js)

   Exit code 0 when every check passes, 1 otherwise.
   ========================================================================= */

"use strict";

let JSDOM, VirtualConsole;
try {
    ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (err) {
    console.error("jsdom is not installed. This is a dev-only check:\n");
    console.error("    npm install --no-save jsdom");
    console.error("    node scripts/verify-flows.js\n");
    process.exit(2);
}

const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const MIME = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".txt": "text/plain"
};

/* Serve the repo over http. jsdom treats file:// as an opaque origin, where
   localStorage throws SecurityError — the app guards against that, but these
   checks need a real origin to assert persistence. */
function serve() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            let rel = decodeURIComponent((req.url || "/").split("?")[0]);
            if (rel === "/") rel = "/index.html";
            const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\]|\.\.)+/, ""));
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); res.end("not found"); return;
            }
            res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
            fs.createReadStream(file).pipe(res);
        });
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => server.close() }));
    });
}

const ROOT = path.resolve(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");

const results = [];
function check(name, pass, detail) {
    results.push({ name, pass: !!pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  -> " + detail : ""}`);
}

/* ---------- browser back-ends jsdom lacks -------------------------------- */
function installStubs(window, log, options) {
    const ctx = {
        fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "",
        font: "", textAlign: "", textBaseline: "",
        setTransform() {}, clearRect() {}, fillRect() {},
        createLinearGradient() { return { addColorStop() {} }; },
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        stroke() { log.strokes++; }, fill() { log.fills++; },
        arc() { log.arcs++; }, save() {}, restore() {},
        setLineDash() {}, fillText(text) { log.texts.push(String(text)); }
    };
    window.HTMLCanvasElement.prototype.getContext = function () { return ctx; };

    window.Element.prototype.getBoundingClientRect = function () {
        if (this.id === "chart") {
            return { x: 0, y: 0, top: 0, left: 0, width: 640, height: 300, right: 640, bottom: 300 };
        }
        if (this.hasAttribute && this.hasAttribute("data-chart-tip")) {
            return { x: 0, y: 0, top: 0, left: 0, width: 140, height: 84, right: 140, bottom: 84 };
        }
        return { x: 0, y: 0, top: 0, left: 0, width: 100, height: 40, right: 100, bottom: 40 };
    };
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get() { return 100; }, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get() { return 40; }, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetLeft", { get() { return 10; }, configurable: true });

    window.matchMedia = function (query) {
        const matches = !!options.reducedMotion && /prefers-reduced-motion/.test(query);
        return {
            matches, media: query, onchange: null,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {}
        };
    };

    window.URL.createObjectURL = function (blob) { options.downloads.push({ blob }); return "blob:mock"; };
    window.URL.revokeObjectURL = function () {};
    window.HTMLAnchorElement.prototype.click = function () {
        options.downloads[options.downloads.length - 1].name = this.download;
    };
    window.scrollTo = function () {};
    Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: (t) => { options.copied.push(t); return Promise.resolve(); } }
    });

    // Capability matrix. jsdom ships a bare DeviceMotionEvent, which is the
    // same shape desktop Chrome exposes; model the other two cases as well.
    if (options.sensor === "none") {
        delete window.DeviceMotionEvent;
    } else if (options.sensor === "permission") {
        const FakeMotion = function () {};
        FakeMotion.requestPermission = function () { return Promise.resolve("granted"); };
        window.DeviceMotionEvent = FakeMotion;
    }
}

async function boot(opts) {
    const options = Object.assign({ reducedMotion: false, sensor: "available", downloads: [], copied: [], origin: "http" }, opts);
    const log = { strokes: 0, fills: 0, arcs: 0, texts: [] };
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.message || e)));
    vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

    const url = options.origin === "file"
        ? pathToFileURL(INDEX).href
        : `http://127.0.0.1:${SERVER.port}/index.html`;

    const dom = await JSDOM.fromURL(url, {
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(window) { installStubs(window, log, options); }
    });

    const window = dom.window;
    await new Promise((r) => setTimeout(r, 600));

    return {
        dom, window, log, errors,
        downloads: options.downloads, copied: options.copied,
        doc: window.document,
        $: (s) => window.document.querySelector(s),
        $$: (s) => Array.from(window.document.querySelectorAll(s)),
        click(sel) {
            const node = typeof sel === "string" ? window.document.querySelector(sel) : sel;
            if (!node) throw new Error("missing element: " + sel);
            node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
            return node;
        },
        wait: (ms) => new Promise((r) => setTimeout(r, ms))
    };
}

let SERVER = null;

(async () => {
    SERVER = await serve();

    /* ================= 1. boot, structure, capability ================= */
    const t = await boot();
    const doc = t.doc;
    const window = t.window;

    check("page boots with no jsdom/console errors", t.errors.length === 0, t.errors.slice(0, 3).join(" | "));
    check("theme resolved on <html>",
        doc.documentElement.getAttribute("data-theme") === "auto" && doc.documentElement.getAttribute("data-system") === "light",
        doc.documentElement.getAttribute("data-theme") + "/" + doc.documentElement.getAttribute("data-system"));
    check("AccUI facade exposed", !!window.AccUI && typeof window.AccUI.theme.set === "function");
    check("sensor-available path hides both alert panels",
        t.$("#unsupported-section").hidden === true && t.$("#permission-section").hidden === true);
    check("status chip reflects capability", t.$("#sensorStatus").textContent === "Sensor ready", t.$("#sensorStatus").textContent);
    check("mode chip set", t.$("#modeStatus").textContent === "Ready", t.$("#modeStatus").textContent);
    check("session copy updated", /Ready to capture/.test(t.$("#sessionStatus").textContent), t.$("#sessionStatus").textContent);
    check("source/state detail rows",
        t.$("#sourceStatus").textContent === "Device sensors" && t.$("#stateStatus").textContent === "Awaiting capture",
        t.$("#sourceStatus").textContent + " / " + t.$("#stateStatus").textContent);
    check("reveal fallback marks sections visible (no IntersectionObserver)",
        t.$$("[data-reveal]").every((n) => n.classList.contains("is-visible")), t.$$("[data-reveal]").length + " nodes");
    check("active section mirrored in both navs",
        t.$$(".nav-link").length === 8 && t.$$(".nav-link.is-active").length === 2,
        t.$$(".nav-link.is-active").map((n) => n.getAttribute("href")).join(","));
    check("chart idle before any data", t.$("[data-chart]").getAttribute("data-state") === "idle");
    check("export buttons disabled with no data",
        t.$("#copyBtn").disabled && t.$("#downloadJsonBtn").disabled && t.$("#downloadCsvBtn").disabled && t.$("#clearBtn").disabled);
    check("editor chip starts Empty",
        t.$("#editorState").textContent === "Empty" && t.$("#data-section").getAttribute("data-state") === "empty");
    check("empty state visible", t.$("#emptyState").hidden === false);
    check("start offered once a sensor exists, stop hidden",
        t.$("#startBtn").hidden === false && t.$("#stopBtn").hidden === true && t.$("#simBtn").hidden === false);

    /* ================= 2. appearance menu + persistence ================= */
    t.click("[data-menu-trigger]");
    await t.wait(40);
    check("menu opens (aria-expanded + panel)",
        t.$("[data-menu-trigger]").getAttribute("aria-expanded") === "true" && t.$("#appearance-menu").hidden === false);
    check("menu opens focused on the checked option",
        doc.activeElement && doc.activeElement.getAttribute("data-theme-option") === "auto",
        doc.activeElement && doc.activeElement.getAttribute("data-theme-option"));

    t.click('[data-theme-option="dark"]');
    await t.wait(40);
    check("dark theme applied + persisted",
        doc.documentElement.getAttribute("data-theme") === "dark" && window.localStorage.getItem("accel-theme") === "dark");
    check("aria-checked moved to Dark",
        t.$('[data-theme-option="dark"]').getAttribute("aria-checked") === "true" &&
        t.$('[data-theme-option="auto"]').getAttribute("aria-checked") === "false");

    t.click("[data-menu-trigger]");
    await t.wait(30);
    t.click("[data-motion-toggle]");
    await t.wait(30);
    check("reduce-motion toggle sets data-motion + hint",
        doc.documentElement.getAttribute("data-motion") === "reduced" &&
        t.$("[data-motion-hint]").textContent === "On" &&
        t.$("[data-motion-toggle]").getAttribute("aria-checked") === "true");
    check("AccUI reports reduced motion", window.AccUI.reducedMotion() === true);
    t.click("[data-motion-toggle]");
    await t.wait(30);
    check("reduce-motion toggle off again",
        doc.documentElement.getAttribute("data-motion") === null && t.$("[data-motion-hint]").textContent === "Off");

    doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await t.wait(220);
    check("Escape closes the menu", t.$("[data-menu-trigger]").getAttribute("aria-expanded") === "false");

    /* ================= 3. simulator -> readouts, chart ================= */
    t.click("#simBtn");
    await t.wait(400);
    const live = {
        label: t.$("#simBtn .btn__label").textContent,
        pressed: t.$("#simBtn").getAttribute("aria-pressed"),
        chartState: t.$("[data-chart]").getAttribute("data-state"),
        valX: t.$("#valX").textContent,
        valMag: t.$("#valMag").textContent,
        levelX: t.$("#readoutX").style.getPropertyValue("--level"),
        chip: t.$("#sensorStatus").textContent
    };
    check("simulator relabels + aria-pressed", live.label === "Stop simulation" && live.pressed === "true", JSON.stringify(live));
    check("readouts stream non-zero values", live.valX !== "0.00" && parseFloat(live.valMag) > 5, live.valX + " / " + live.valMag);
    check("readout meter level driven", parseFloat(live.levelX) > 0 && parseFloat(live.levelX) <= 1, live.levelX);
    check("chart leaves idle state", live.chartState === "live");
    check("status chip switches to simulation", live.chip === "Simulation active", live.chip);
    check("canvas grid + 3 series drawn", t.log.texts.length >= 3 && t.log.arcs >= 6,
        `texts=${t.log.texts.length} arcs=${t.log.arcs} strokes=${t.log.strokes}`);
    check("axis labels drawn from data", t.log.texts.slice(0, 3).join("|").startsWith("+"), t.log.texts.slice(0, 3).join("|"));

    // Freeze the stream, then count markers in a single controlled frame.
    t.click("#simBtn");
    await t.wait(150);
    async function arcsPerFrame() {
        t.log.arcs = 0;
        window.dispatchEvent(new window.Event("resize"));
        await t.wait(90);
        return t.log.arcs;
    }
    const arcsAll = await arcsPerFrame();
    t.click('[data-series="y"]');
    await t.wait(60);
    const arcsTwo = await arcsPerFrame();
    check("legend button toggles aria-pressed", t.$('[data-series="y"]').getAttribute("aria-pressed") === "false");
    check("hidden series is not drawn (6 markers -> 4)", arcsAll === 6 && arcsTwo === 4, `all=${arcsAll} two=${arcsTwo}`);
    t.click('[data-series="y"]');
    await t.wait(60);
    const arcsBack = await arcsPerFrame();
    check("series returns when re-enabled", arcsBack === 6, String(arcsBack));
    t.click("#simBtn");
    await t.wait(300);

    /* ================= 4. record -> stop -> export state ================= */
    t.click("#startBtn");
    await t.wait(350);
    check("recording badge + stop button swap",
        t.$("#recording-badge").hidden === false && t.$("#stopBtn").hidden === false && t.$("#startBtn").hidden === true);
    check("stats panel visible while recording", t.$("#stats").hidden === false);
    check("body mode reflects recording", doc.body.dataset.mode === "recording", doc.body.dataset.mode);
    check("editor shows recording state",
        t.$("#data-section").getAttribute("data-state") === "recording" && t.$("#editorState").textContent === "Recording");
    check("empty state text switches to recording", /Recording in progress/.test(t.$("#emptyStateTitle").textContent));

    t.click("#stopBtn");
    await t.wait(320);   // let the leaving crossfade commit `hidden`
    let samples;
    try { samples = JSON.parse(t.$("#textarea").value); } catch (e) { samples = null; }
    check("stop writes JSON array to the editor", Array.isArray(samples) && samples.length > 5,
        Array.isArray(samples) ? samples.length + " samples" : "parse failed");
    check("sample schema unchanged (t,x,y,z,mag)",
        samples && Object.keys(samples[0]).join(",") === "t,x,y,z,mag", samples ? Object.keys(samples[0]).join(",") : "n/a");
    check("magnitude is correct",
        samples && Math.abs(samples[0].mag - Math.hypot(samples[0].x, samples[0].y, samples[0].z)) < 1e-9);
    check("timestamps increase", samples && samples[samples.length - 1].t > samples[0].t);
    check("stats report count/duration/rate",
        /^\d+$/.test(t.$("#statCount").textContent) && /s$/.test(t.$("#statDuration").textContent) && /Hz$/.test(t.$("#statRate").textContent),
        [t.$("#statCount").textContent, t.$("#statDuration").textContent, t.$("#statRate").textContent].join(" "));
    check("export controls enabled",
        !t.$("#copyBtn").disabled && !t.$("#downloadJsonBtn").disabled && !t.$("#downloadCsvBtn").disabled && !t.$("#clearBtn").disabled);
    check("editor chip reports ready samples",
        t.$("#data-section").getAttribute("data-state") === "ready" && /^\d+ samples$/.test(t.$("#editorState").textContent),
        t.$("#editorState").textContent);
    check("empty state hidden with data", t.$("#emptyState").hidden === true);
    check("recording badge cleared", t.$("#recording-badge").hidden === true);

    /* ================= 5. editor: invalid JSON, edit, format ================= */
    const recordedCount = samples.length;
    t.$("#textarea").value = '[{"t":0,"x":1,';
    t.$("#textarea").dispatchEvent(new window.Event("input", { bubbles: true }));
    await t.wait(30);
    check("invalid JSON flagged, exports fall back safely",
        t.$("#data-section").getAttribute("data-state") === "invalid" &&
        t.$("#editorState").textContent === "Invalid JSON" &&
        /invalid JSON/i.test(t.$("#dataSummary").textContent), t.$("#dataSummary").textContent);
    check("format disabled on invalid JSON", t.$("#formatBtn").disabled === true);

    t.click("#downloadCsvBtn");
    await t.wait(70);
    const fallbackCsv = t.downloads.length ? await t.downloads[t.downloads.length - 1].blob.text() : "";
    check("invalid editor falls back to recorded data",
        fallbackCsv.split("\n").length === recordedCount + 1,
        (fallbackCsv.split("\n").length - 1) + " rows for " + recordedCount + " samples");

    t.$("#textarea").value = '[{"t":0,"x":1.5,"y":-0.25,"z":9.8,"mag":9.92}]';
    t.$("#textarea").dispatchEvent(new window.Event("input", { bubbles: true }));
    await t.wait(30);
    check("edited JSON becomes the export source",
        t.$("#data-section").getAttribute("data-state") === "ready" &&
        t.$("#editorState").textContent === "1 sample" &&
        t.$("#dataSummary").textContent === "1 sample ready",
        t.$("#editorState").textContent + " / " + t.$("#dataSummary").textContent);
    check("format enabled for valid JSON", t.$("#formatBtn").disabled === false);

    t.click("#formatBtn");
    await t.wait(70);
    check("format prettifies the array", /\n {2}\{/.test(t.$("#textarea").value), JSON.stringify(t.$("#textarea").value.slice(0, 24)));
    check("format marks the button done", t.$("#formatBtn").classList.contains("is-done"));

    /* ================= 6. export: JSON, CSV, clipboard ================= */
    const before = t.downloads.length;
    t.click("#downloadJsonBtn");
    await t.wait(90);
    const jsonDl = t.downloads[before];
    const jsonText = jsonDl ? await jsonDl.blob.text() : "";
    check("JSON download produced", !!jsonDl && /^accelerometer-\d{4}-\d\d-\d\dT.*\.json$/.test(jsonDl.name), jsonDl && jsonDl.name);
    check("JSON download content is the edited array", JSON.parse(jsonText).length === 1 && JSON.parse(jsonText)[0].x === 1.5);

    t.click("#downloadCsvBtn");
    await t.wait(90);
    const csvText = await t.downloads[t.downloads.length - 1].blob.text();
    check("CSV download has header + row",
        csvText.split("\n")[0] === "time,x,y,z,magnitude" && csvText.split("\n")[1] === "0,1.5,-0.25,9.8,9.92",
        JSON.stringify(csvText));

    t.click("#copyBtn");
    await t.wait(90);
    check("clipboard copy used the edited data", t.copied.length === 1 && JSON.parse(t.copied[0])[0].x === 1.5);
    check("success toast with follow-up action",
        t.$("#err").hidden === false && t.$("#err").getAttribute("data-variant") === "success" &&
        /Copied 1 samples/.test(t.$("[data-toast-msg]").textContent) &&
        t.$("[data-toast-action]").textContent === "Download",
        t.$("[data-toast-msg]").textContent + " | action=" + t.$("[data-toast-action]").textContent);
    check("copy button shows the done morph", t.$("#copyBtn").classList.contains("is-done"));

    const dlBefore = t.downloads.length;
    t.click("[data-toast-action]");
    await t.wait(90);
    check("toast action triggers the download", t.downloads.length === dlBefore + 1);
    check("toast re-announces the action result",
        /Downloaded 1 samples as JSON/.test(t.$("[data-toast-msg]").textContent) && t.$("[data-toast-action]").hidden === true,
        t.$("[data-toast-msg]").textContent);

    t.click("#copyBtn");
    await t.wait(70);
    t.click("[data-toast-close]");
    await t.wait(70);
    check("toast close button clears it", t.$("#err").classList.contains("is-visible") === false);

    /* ================= 7. clear -> confirm dialog ================= */
    if (t.$("#simBtn").getAttribute("aria-pressed") === "true") { t.click("#simBtn"); await t.wait(150); }
    t.click("#clearBtn");
    await t.wait(90);
    check("clear opens the confirm dialog",
        t.$("#confirm-dialog").hidden === false && t.$("[data-dialog-scrim]").hidden === false);
    check("dialog focuses a safe control", doc.activeElement === t.$("[data-dialog-cancel]"),
        doc.activeElement && doc.activeElement.textContent);

    t.click("[data-dialog-scrim]");
    await t.wait(70);
    check("scrim click closes the dialog", t.$("#confirm-dialog").classList.contains("is-open") === false);
    check("data survives a cancelled clear", t.$("#textarea").value.length > 0);

    t.click("#clearBtn");
    await t.wait(70);
    t.click("[data-dialog-confirm]");
    await t.wait(320);
    check("confirm clears the session",
        t.$("#textarea").value === "" && t.$("#stats").hidden === true &&
        t.$("#copyBtn").disabled === true && t.$("#clearBtn").disabled === true);
    check("stats panel really leaves the a11y tree",
        t.$("#stats").hidden === true && t.$("#stats").classList.contains("is-leaving") === false,
        "hidden=" + t.$("#stats").hidden);
    check("chart returns to idle + empty state returns",
        t.$("[data-chart]").getAttribute("data-state") === "idle" &&
        t.$("#emptyState").hidden === false && t.$("#data-section").classList.contains("is-empty"),
        t.$("[data-chart]").getAttribute("data-state"));
    check("readouts reset to zero", t.$("#valX").textContent === "0.00" && t.$("#valMag").textContent === "0.00");

    const simWasRunning = t.$("#simBtn").getAttribute("aria-pressed");
    if (simWasRunning === "true") { t.click("#simBtn"); await t.wait(70); }
    t.click("[data-empty-action]");
    await t.wait(220);
    check("empty-state action starts the simulator", t.$("#simBtn").getAttribute("aria-pressed") === "true");
    t.click("#simBtn");
    await t.wait(70);
    check("simulator stops cleanly",
        t.$("#simBtn .btn__label").textContent === "Simulate data" && t.$("#simBtn").getAttribute("aria-pressed") === "false");

    /* ================= 8. chart inspection ================= */
    t.click("#simBtn");
    await t.wait(320);
    const canvas = t.$("#chart");
    canvas.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 150, pointerType: "mouse" }));
    await t.wait(140);
    const tip = {
        hidden: t.$("[data-chart-tip]").hidden,
        visible: t.$("[data-chart-tip]").classList.contains("is-visible"),
        time: t.$("[data-tip-time]").textContent,
        x: t.$("[data-tip-value='x']").textContent,
        tx: t.$("[data-chart-tip]").style.getPropertyValue("--tip-x")
    };
    check("pointer hover opens the chart tooltip",
        tip.hidden === false && tip.visible && /^\+\d+\.\d\ds$/.test(tip.time) && /^-?\d+\.\d\d$/.test(tip.x), JSON.stringify(tip));
    check("tooltip positioned inside the plot", parseFloat(tip.tx) >= 0 && parseFloat(tip.tx) <= 640, tip.tx);

    canvas.dispatchEvent(new window.PointerEvent("pointerleave", { bubbles: true, pointerType: "mouse" }));
    await t.wait(140);
    check("tooltip hides on pointer leave", t.$("[data-chart-tip]").classList.contains("is-visible") === false);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await t.wait(140);
    check("keyboard Home inspects the first sample",
        t.$("[data-chart-tip]").classList.contains("is-visible") && t.$("[data-tip-time]").textContent === "+0.00s",
        t.$("[data-tip-time]").textContent);
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await t.wait(140);
    check("ArrowRight advances the cursor", t.$("[data-tip-time]").textContent !== "+0.00s", t.$("[data-tip-time]").textContent);
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await t.wait(140);
    check("Escape clears the cursor", t.$("[data-chart-tip]").classList.contains("is-visible") === false);
    t.click("#simBtn");
    await t.wait(70);

    check("no errors during the full desktop flow", t.errors.length === 0, t.errors.slice(0, 3).join(" | "));
    t.window.close();

    /* ================= 9. reduced motion boot ================= */
    const r = await boot({ reducedMotion: true });
    check("reduced motion detected at boot", r.window.AccUI.reducedMotion() === true);
    check("reduced motion: reveals shown immediately", r.$$("[data-reveal]").every((n) => n.classList.contains("is-visible")));
    r.click("#simBtn");
    await r.wait(220);
    r.click("#startBtn");
    await r.wait(220);
    r.click("#stopBtn");
    await r.wait(80);
    check("reduced motion: full record flow still works",
        r.$("#textarea").value.length > 10 && r.$("#stats").hidden === false);
    check("reduced motion: no errors", r.errors.length === 0, r.errors.slice(0, 3).join(" | "));
    r.window.close();

    /* ================= 10. permission-gated devices ================= */
    const p = await boot({ sensor: "permission" });
    check("permission panel shown, sensors not read yet",
        p.$("#permission-section").hidden === false && p.$("#sensorStatus").textContent === "Permission needed",
        p.$("#sensorStatus").textContent);
    check("permission copy + pending state",
        /Waiting for motion access/.test(p.$("#sessionStatus").textContent) &&
        p.$("#stateStatus").textContent === "Permission required");
    check("recording not offered before permission", p.$("#startBtn").hidden === true);
    p.click("#permission-btn");
    await p.wait(140);
    check("granted permission starts the leave transition",
        p.$("#permission-section").classList.contains("is-leaving") === true || p.$("#permission-section").hidden === true);
    await p.wait(280);
    check("after grant: panel gone, ready to capture",
        p.$("#permission-section").hidden === true && p.$("#sensorStatus").textContent === "Sensor ready" && p.$("#startBtn").hidden === false,
        p.$("#sensorStatus").textContent);
    check("permission flow produced no errors", p.errors.length === 0, p.errors.slice(0, 2).join(" | "));
    p.window.close();

    /* ================= 11. no DeviceMotion at all ================= */
    const n = await boot({ sensor: "none" });
    check("unsupported panel shown", n.$("#unsupported-section").hidden === false && n.$("#permission-section").hidden === true);
    check("unsupported messaging",
        n.$("#sensorStatus").textContent === "Motion unavailable" &&
        /does not support the DeviceMotion API/.test(n.$("#unsupported-note").textContent),
        n.$("#unsupported-note").textContent);
    check("simulator still offered", n.$("#simBtn").hidden === false && n.$("#startBtn").hidden === true);
    n.click("#simBtn");
    await n.wait(260);
    n.click("#startBtn");
    await n.wait(220);
    n.click("#stopBtn");
    await n.wait(320);
    const simOnly = (() => { try { return JSON.parse(n.$("#textarea").value).length; } catch (e) { return "invalid"; } })();
    check("full flow works with no sensor at all", typeof simOnly === "number" && simOnly > 3, simOnly + " samples");
    check("unsupported boot produced no errors", n.errors.length === 0, n.errors.slice(0, 2).join(" | "));
    n.window.close();

    /* ================= 12. opaque origin (no localStorage) ================= */
    /* Safari private mode and sandboxed iframes deny storage. The app wraps
       every access in try/catch; this asserts it still works end to end. */
    const o = await boot({ origin: "file" });
    let storageThrew = false;
    try { o.window.localStorage.getItem("accel-theme"); } catch (e) { storageThrew = e.name === "SecurityError"; }
    check("file:// origin really does deny localStorage (premise of this test)", storageThrew === true);
    check("opaque origin boots without errors", o.errors.length === 0, o.errors.slice(0, 2).join(" | "));
    o.click('[data-theme-option="dark"]');
    await o.wait(50);
    check("opaque origin: theme still applies",
        o.doc.documentElement.getAttribute("data-theme") === "dark", o.doc.documentElement.getAttribute("data-theme"));
    o.click("#simBtn");
    await o.wait(220);
    o.click("#startBtn");
    await o.wait(220);
    o.click("#stopBtn");
    await o.wait(320);
    let opaqueSamples = 0;
    try { opaqueSamples = JSON.parse(o.$("#textarea").value).length; } catch (e) { opaqueSamples = 0; }
    check("opaque origin: record flow still works", opaqueSamples > 3, opaqueSamples + " samples");
    check("opaque origin: no errors anywhere in the flow", o.errors.length === 0, o.errors.slice(0, 2).join(" | "));
    o.window.close();

    SERVER.close();

    /* ================= summary ================= */
    const failed = results.filter((x) => !x.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log("FAILED:");
        failed.forEach((f) => console.log("  - " + f.name + (f.detail !== undefined ? "  -> " + f.detail : "")));
    }
    process.exitCode = failed.length ? 1 : 0;
    process.exit(process.exitCode);
})().catch((e) => {
    console.error("HARNESS ERROR:", e && e.name, e && e.message);
    console.error(e && e.stack);
    process.exit(2);
});
