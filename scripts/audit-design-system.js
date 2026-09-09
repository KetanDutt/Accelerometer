#!/usr/bin/env node
/* =========================================================================
   audit-design-system.js — static checks for the Liquid Glass design system
   -------------------------------------------------------------------------
   Zero dependencies (plain Node, no npm install), so it can run in CI next to
   the existing checks without breaking the project's no-build philosophy.

   What it verifies:
     1. CSS sanity        — balanced blocks in every sheet.
     2. Token resolution  — every var(--x) used anywhere resolves to a real
                            definition. This is the check that catches typos a
                            CSS parser happily accepts.
     3. Class coverage    — classes in markup/JS have rules, and rules have
                            markup; every chip variant emitted by JS is styled.
     4. Icon integrity    — every <use href="#i-..."> resolves to a symbol.
     5. Token discipline  — component sheets contain no raw hex colour, literal
                            radius, literal duration or numeric z-index.
     6. WCAG contrast     — each text token composited over its real surface
                            stack (tint -> glass -> page), both themes.

   Usage:  node scripts/audit-design-system.js
   Exits 0 when clean, 1 on any problem.
   ========================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TOKEN_SHEET = "css/tokens.css";
const SHEETS = ["tokens", "base", "components", "layout", "motion"].map((n) => `css/${n}.css`);

let problems = 0;
const fail = (m) => { problems++; console.log("  x " + m); };
const ok = (m) => console.log("  + " + m);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const html = read("index.html");
const js = ["js/app.js", "js/ui.js"].map(read).join("\n");
const sheets = {};
for (const f of SHEETS) sheets[f] = read(f);

/* ---------- 1. CSS sanity ------------------------------------------------ */
console.log("\n1. CSS structure");
for (const f of SHEETS) {
    const src = stripComments(sheets[f]);
    const open = (src.match(/{/g) || []).length;
    const close = (src.match(/}/g) || []).length;
    if (open !== close) fail(`${f}: unbalanced braces (${open} open, ${close} close)`);
    else ok(`${f}: balanced (${open} blocks)`);
}

/* ---------- token model --------------------------------------------------- */
/* Collect declarations per selector so the dark profile can be read as an
   override of the light base, exactly as the cascade would apply it. */
function declarationsFor(selectorTest) {
    const out = {};
    const src = stripComments(sheets[TOKEN_SHEET]);
    // Walk top-level rules and @media blocks one level deep.
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(src)) !== null) {
        const selector = m[1].trim();
        if (selectorTest(selector)) {
            (m[2].match(/--[\w-]+\s*:[^;]+;/g) || []).forEach((d) => {
                const i = d.indexOf(":");
                out[d.slice(0, i).trim()] = d.slice(i + 1, -1).trim();
            });
        }
    }
    return out;
}

const isLightRoot = (s) => s === ":root";
const isDarkRoot = (s) => s.includes('[data-theme="dark"]') && !s.includes("prefers-");
const lightTokens = declarationsFor(isLightRoot);
const darkTokens = Object.assign({}, lightTokens, declarationsFor(isDarkRoot));

const definedTokens = new Set(Object.keys(lightTokens).concat(Object.keys(darkTokens)));

// Component-local custom properties: the material system works by re-pointing
// these inside the rule that uses them, so they are defined in the component
// sheets rather than in tokens.css.
const localTokens = new Set();
for (const f of SHEETS) {
    (stripComments(sheets[f]).match(/^\s*(--[\w-]+)\s*:/gm) || [])
        .forEach((d) => localTokens.add(d.trim().replace(/\s*:$/, "")));
}
// Properties written at runtime (style.setProperty, inline style="").
const runtimeTokens = new Set();
(html.match(/--[\w-]+\s*:/g) || []).forEach((d) => runtimeTokens.add(d.replace(/\s*:$/, "")));
(js.match(/setProperty\(\s*"(--[\w-]+)"/g) || []).forEach((d) => runtimeTokens.add(d.match(/"(--[\w-]+)"/)[1]));

const resolvable = new Set([...definedTokens, ...localTokens, ...runtimeTokens]);

/* ---------- 2. Token resolution ------------------------------------------ */
console.log("\n2. Token resolution (every var() must resolve)");
{
    const unresolved = new Map();
    for (const f of SHEETS) {
        const src = stripComments(sheets[f]);
        (src.match(/var\(\s*(--[\w-]+)/g) || []).forEach((use) => {
            const name = use.replace(/var\(\s*/, "");
            if (!resolvable.has(name)) {
                const key = `${name} (in ${f})`;
                unresolved.set(key, (unresolved.get(key) || 0) + 1);
            }
        });
    }
    // Inline styles / JS that set a custom property are legitimate producers.
    const produced = new Set();
    (html.match(/--[\w-]+\s*:/g) || []).forEach((d) => produced.add(d.replace(/\s*:$/, "")));
    (js.match(/setProperty\(\s*"(--[\w-]+)"/g) || []).forEach((d) => produced.add(d.match(/"(--[\w-]+)"/)[1]));

    const dangling = [...unresolved.keys()].filter((k) => !produced.has(k.split(" ")[0]));
    if (dangling.length) fail("unresolved var() references: " + dangling.join(", "));
    else ok(`all var() references resolve against ${definedTokens.size} defined tokens`);

    // Scales are a vocabulary: an unused step is fine and often necessary for
    // the next component. One-off aliases are a commitment and must be used.
    const scaleFamily = /^--(?:space|text|leading|radius|blur|dur|weight|tracking|z)-/;
    const cssAll = SHEETS.map((f) => sheets[f]).join("\n");
    const usedSomewhere = (t) =>
        cssAll.includes("var(" + t) || js.includes('"' + t + '"') || html.includes("var(" + t);

    const unused = [...definedTokens].filter((t) => !usedSomewhere(t));
    const deadOnes = unused.filter((t) => !scaleFamily.test(t));
    const idleSteps = unused.filter((t) => scaleFamily.test(t));

    if (deadOnes.length) fail("one-off tokens defined but never used: " + deadOnes.join(", "));
    else ok("every one-off token is used");
    console.log(`    (${idleSteps.length} unused scale steps kept as vocabulary: ${idleSteps.join(", ") || "none"})`);
}

/* ---------- 3. Class coverage -------------------------------------------- */
console.log("\n3. Class coverage (markup/JS <-> CSS)");
{
    const cssClasses = new Set();
    for (const f of SHEETS) {
        // url(...) payloads (the SVG grain data-URI) are not selectors
        const src = stripComments(sheets[f]).replace(/url\([^)]*\)/g, "url()");
        (src.match(/\.[a-zA-Z][\w-]*/g) || []).forEach((c) => cssClasses.add(c.slice(1)));
    }
    const htmlClasses = new Set();
    (html.match(/class="([^"]+)"/g) || []).forEach((a) =>
        a.slice(7, -1).split(/\s+/).filter(Boolean).forEach((c) => htmlClasses.add(c)));
    const jsClasses = new Set();
    (js.match(/classList\.(?:add|remove|toggle|contains)\(\s*"([^"]+)"/g) || [])
        .forEach((m) => m.match(/"([^"]+)"/)[1].split(" ").forEach((c) => jsClasses.add(c)));

    const used = new Set([...htmlClasses, ...jsClasses]);
    // Classes built by string concatenation at runtime (e.g. "chip--" + variant).
    const dynamic = (c) => c.startsWith("chip--") || c.startsWith("is-");

    const unstyled = [...htmlClasses].filter((c) => !cssClasses.has(c)).sort();
    if (unstyled.length) fail("markup classes with no CSS rule: " + unstyled.join(", "));
    else ok("every class in the markup has a rule");

    const orphaned = [...cssClasses].filter((c) => !used.has(c) && !dynamic(c)).sort();
    if (orphaned.length) fail("CSS rules with no markup: " + orphaned.join(", "));
    else ok("no orphaned component classes");

    const variants = ["quiet", "live", "success", "warning", "danger"];
    const missing = variants.filter((v) => !cssClasses.has("chip--" + v));
    if (missing.length) fail("setChipVariant() can emit unstyled classes: " + missing.join(", "));
    else ok(`all ${variants.length} chip variants emitted by JS are styled`);
}

/* ---------- 4. Icon integrity --------------------------------------------- */
console.log("\n4. Icon sprite integrity");
{
    const symbols = new Set((html.match(/<symbol id="([^"]+)"/g) || [])
        .map((m) => m.match(/id="([^"]+)"/)[1]));
    const used = new Set((html.match(/href="#(i-[^"]+)"/g) || []).map((m) => m.slice(7, -1)));
    const missing = [...used].filter((i) => !symbols.has(i));
    if (missing.length) fail("icons referenced but missing from the sprite: " + missing.join(", "));
    else ok(`all ${used.size} referenced icons exist`);
    const unused = [...symbols].filter((i) => !used.has(i));
    if (unused.length) fail("sprite symbols never used: " + unused.join(", "));
    else ok("no unused symbols");
}

/* ---------- 5. Token discipline ------------------------------------------- */
console.log("\n5. Token discipline (raw values belong in tokens.css only)");
for (const f of SHEETS.filter((x) => x !== TOKEN_SHEET)) {
    const src = stripComments(sheets[f])
        // mask paints define a clip, not a colour
        .replace(/(?:-webkit-)?mask:[^;]+;/g, "");
    const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const rgba = src.match(/rgba?\([^)]*\)/g) || [];
    const radii = src.match(/border-radius:\s*[^;]*\d+px/g) || [];
    const zs = src.match(/z-index:\s*\d+/g) || [];
    const durs = src.match(/\b\d{2,4}ms\b/g) || [];
    if (hex.length) fail(`${f}: hard-coded hex colours: ${[...new Set(hex)].slice(0, 6).join(", ")}`);
    if (rgba.length) fail(`${f}: hard-coded rgb()/rgba(): ${[...new Set(rgba)].slice(0, 4).join(", ")}`);
    if (radii.length) fail(`${f}: literal border radii: ${[...new Set(radii)].join(" | ")}`);
    if (zs.length) fail(`${f}: numeric z-index: ${[...new Set(zs)].join(", ")}`);
    if (durs.length) fail(`${f}: literal durations: ${[...new Set(durs)].join(", ")}`);
    if (!hex.length && !rgba.length && !radii.length && !zs.length && !durs.length) ok(`${f}: clean`);
}

/* ---------- 6. WCAG contrast ---------------------------------------------- */
console.log("\n6. WCAG contrast (foreground composited over its real surface)");
function parseColor(value) {
    const v = String(value || "").trim();
    let m = v.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
        const p = m[1].split(",").map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    m = v.match(/^#([\da-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    return null;
}
function firstStop(value) {
    const m = String(value).match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
    return m ? m[0] : value;
}
function over(fg, bg) {
    if (!fg || !bg) return null;
    return {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1
    };
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
function r0(a, b) { return luminance(a) + luminance(b); }
function ratio(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function auditTheme(name, T) {
    const missing = ["--bg-base", "--mat-primary-bg", "--mat-inset-bg", "--mat-floating-bg",
        "--mat-appbar-rest-bg", "--pill-bg", "--fill-sunken"].filter((t) => !parseColor(firstStop(T[t])));
    if (missing.length) {
        fail(`${name}: cannot resolve surface tokens: ${missing.join(", ")}`);
        return;
    }
    const page = parseColor(T["--bg-base"]);
    const glassPrimary = over(parseColor(T["--mat-primary-bg"]), page);
    const glassInset = over(parseColor(T["--mat-inset-bg"]), glassPrimary);
    const glassFloating = over(parseColor(T["--mat-floating-bg"]), page);
    const appbar = over(parseColor(T["--mat-appbar-rest-bg"]), page);
    const pill = over(parseColor(firstStop(T["--pill-bg"])), glassFloating);

    const cases = [
        ["heading on primary glass", T["--text-strong"], glassPrimary, 3],
        ["body copy on primary glass", T["--text-secondary"], glassPrimary, 4.5],
        ["muted label on primary glass", T["--text-tertiary"], glassPrimary, 4.5],
        ["body text on primary glass", T["--text"], glassPrimary, 4.5],
        ["stat value on inset card", T["--text-strong"], glassInset, 4.5],
        ["editor text on sunken field", T["--text"], over(parseColor(T["--fill-sunken"]), glassInset), 4.5],
        ["nav label on appbar", T["--text-secondary"], appbar, 4.5],
        ["active nav on pill", T["--text-strong"], pill, 4.5],
        ["toast text on floating glass", T["--text-strong"], glassFloating, 4.5],
        ["primary button label", T["--text-on-accent"], parseColor(T["--accent"]), 4.5],
        ["success button label", T["--text-on-accent"], parseColor(T["--success"]), 4.5],
        ["danger button label", T["--text-on-accent"], parseColor(T["--danger"]), 4.5],
        ["accent chip text", T["--accent-contrast"], over(parseColor(T["--accent-soft"]), glassFloating), 4.5],
        ["success chip text", T["--success-contrast"], over(parseColor(T["--success-soft"]), glassFloating), 4.5],
        ["danger chip text", T["--danger-contrast"], over(parseColor(T["--danger-soft"]), glassFloating), 4.5],
        ["warning chip text", T["--warning-contrast"], over(parseColor(T["--warning-soft"]), glassFloating), 4.5],
        ["recording badge text", T["--danger-contrast"], over(parseColor(T["--danger-soft"]), glassPrimary), 4.5],
        // chart series and toast icons are graphical: WCAG 1.4.11 asks for 3:1
        ["series X on inset card", T["--series-x"], glassInset, 3],
        ["series Y on inset card", T["--series-y"], glassInset, 3],
        ["series Z on inset card", T["--series-z"], glassInset, 3],
        ["toast icon (non-text)", T["--success"], over(parseColor(T["--success-soft"]), glassFloating), 3]
    ];

    console.log(`  ${name}:`);
    let worst = Infinity;
    let worstLabel = "";
    for (const [label, token, bg, min] of cases) {
        const fg = parseColor(token);
        if (!fg || !bg) { fail(`${name}: cannot resolve colour for "${label}" (${token})`); continue; }
        if (!Number.isFinite(r0(fg, bg))) continue;
        const r = ratio(fg, bg);
        if (r < worst) { worst = r; worstLabel = label; }
        if (r < min) { fail(`${name}: ${label} = ${r.toFixed(2)}:1 (needs ${min}:1)`); problems++; }
    }
    console.log(`    lowest ${worst.toFixed(2)}:1 (${worstLabel})`);
}
auditTheme("light", lightTokens);
auditTheme("dark", darkTokens);

console.log(`\n${problems === 0 ? "DESIGN SYSTEM AUDIT CLEAN" : problems + " problem(s) found"}`);
process.exitCode = problems === 0 ? 0 : 1;
