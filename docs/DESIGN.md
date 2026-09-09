# Design system

This document describes the visual language of the app: the Liquid Glass material
system, the token architecture, and the rules that keep every screen consistent.

> **Principle:** *fast in response, smooth in motion.* Glass is used to create
> depth and hierarchy — never as decoration, and never at the cost of legibility.

---

## 1. File layout

```
css/
├── tokens.css       # the only file allowed to contain raw values
├── base.css         # reset, ambient background (layer 0), typography, focus
├── components.css   # glass materials, buttons, chips, nav, cards, chart, dialog, toast
├── layout.css       # appbar, hero, workspace grid, dock, responsive rules
└── motion.css       # keyframes, reveals, and every preference media query
```

`js/ui.js` owns presentation behaviour (theme, popovers, the gliding nav
indicator, dialogs, reveals, pointer micro-interactions). `js/app.js` owns
application logic and reaches the presentation layer only through the optional
`window.AccUI` facade, so it still works if that file is absent.

---

## 2. Design tokens

Everything is a token. A component sheet must never contain a hex colour, a
literal radius, a literal duration or a numeric `z-index` — the static audit in
`docs/DEVELOPMENT.md` enforces this.

| Group | Examples |
| --- | --- |
| Type | `--font-sans`, `--text-2xs`…`--text-display`, `--leading-*`, `--tracking-*`, `--weight-*` |
| Space | `--space-1`…`--space-10`, `--gap-section`, `--gutter`, `--measure` |
| Geometry | `--radius-xs`…`--radius-2xl`, `--radius-pill` |
| Blur | `--blur-xs`…`--blur-xl` |
| Motion | `--dur-1`…`--dur-5`, `--dur-meter`, `--ease-out/in-out/standard/spring` |
| Layers | `--z-ambient` 0 → `--z-toast` 60, plus `--z-within` for local stacking |
| Light physics | `--edge-light`, `--sheen`, `--specular`, `--inset-light` |

### Themes

One dark block, applied either explicitly or from the system preference:

```css
:root[data-theme="dark"],
:root[data-theme="auto"][data-system="dark"] { … }
```

A six-line inline script in `<head>` resolves the stored choice before first
paint (no flash), and `js/ui.js` keeps `data-system` in sync with the OS and
persists the user's choice in `localStorage` (`accel-theme`).

---

## 3. Material system

Every material exposes the same five properties, so a `.glass--*` class only
re-points variables — the rendering rule exists exactly once:

| Material | Use | Character |
| --- | --- | --- |
| `.glass--primary` | hero, live panel, export studio | most opaque, `--blur-lg`, `saturate(1.7)` |
| `.glass--secondary` | info cards, footer | lighter, `--blur-md` |
| `.glass--tinted` | permission / accent states | accent-tinted |
| `.glass--warning` | unsupported / destructive notices | amber-tinted |
| `.glass--floating` | appbar, menus, dialog, toast, chart cursor | `--blur-xl`, `saturate(1.85)`, strongest shadow |
| `.card--inset` | readouts, chart, editor, stats — anything **inside** a glass surface | fill only, **no** `backdrop-filter` |

Two details that matter:

1. **No nested backdrop filters.** A second blur inside an already-blurred
   surface costs frames and turns muddy, so inset surfaces are translucent fills.
2. **Highlights are pseudo-elements with `z-index: -1`** inside an isolated
   stacking context, so no child ever needs `position: relative` to sit above the
   glass, and nothing has to be clipped with `overflow: hidden` (which would
   otherwise cut off popovers and tooltips).

---

## 4. Layering

| Layer | Token | Contents |
| --- | --- | --- |
| 0 | `--z-ambient` | ambient fields + grain |
| 1 | `--z-content` | page shell |
| 2 | `--z-card` | panels and cards |
| 3 | `--z-nav` | appbar, mobile dock |
| 4 | `--z-popover` | appearance menu |
| 5 | `--z-dialog` | scrim + confirm dialog |
| 6 | `--z-toast` | notifications |

---

## 5. Background

Layer 0 is a vertical gradient plus three very low-contrast colour fields
(`--bg-ambient-a/b/c`) that drift on 46–68 second transform-only loops, and a
fine SVG grain to stop large flat fields banding. The fields should be almost
invisible until a glass surface passes over them.

---

## 6. Typography

System stack (`-apple-system`, `SF Pro`, `Inter`, `system-ui`). Hierarchy:

| Role | Token | Notes |
| --- | --- | --- |
| Page title | `--text-display`, weight 640 | `-0.032em` tracking |
| Section heading | `--text-2xl`, weight 590 | |
| Panel heading | `--text-lg` / `--text-md` | |
| Body | `--text-base`, 1.62 line height | `--measure` caps line length |
| Metadata | `--text-2xs` uppercase | `+0.09em` tracking |
| Numerals | `--font-mono` + `tabular-nums` | readouts, stats, editor, chart tooltip |

Numeric readouts use tabular monospace so digits never jitter at 60 Hz.

---

## 7. Colour and contrast

Status hues have two grades:

- `--success`, `--danger`, `--warning` — icons, dots, chart series (≥ 3:1).
- `--success-contrast`, `--danger-contrast`, `--warning-contrast` — **text** on a
  soft tint (≥ 4.5:1). Chips and the recording badge use these.

The contrast audit composits each foreground over its real surface (tint →
glass → page) rather than over a flat white, because translucency changes the
answer. Current results: **light 3.37:1 minimum** (large readout numerals),
**dark 6.76:1 minimum**; all body text ≥ 7:1 in both themes.

---

## 8. Motion

| Budget | Token | Used for |
| --- | --- | --- |
| 120 ms | `--dur-1` | hover, press, icon swaps |
| 180 ms | `--dur-2` | chips, menus, focus rings, meters |
| 260 ms | `--dur-3` | cards, panels, nav indicator glide |
| 380 ms | `--dur-4` | section reveals |
| 520 ms | `--dur-5` | dialogs |

Only `transform`, `opacity` and `filter` animate. Easings: `--ease-out` for
entering, `--ease-spring` (slight overshoot) for interactive elements,
`--ease-standard` for structural transitions.

Motion is disabled — not merely shortened — for `prefers-reduced-motion: reduce`
and for the in-app **Reduce motion** switch (`<html data-motion="reduced">`,
persisted in `accel-motion`).

Other preferences honoured: `prefers-reduced-transparency` (solid surfaces, no
ambient fields), `prefers-contrast: more` (stronger hairlines and text),
`forced-colors`, and print.

---

## 9. Components

- **Appbar** floats above content and firms up as you scroll: at rest it uses
  `--mat-appbar-rest-*` (lighter, `--blur-md`); once `body.is-scrolled` it adopts
  the floating material at `--blur-xl`.
- **Navigation** exists twice — a segmented bar on desktop and a thumb-friendly
  dock below 900 px — sharing one `.nav-link` hook so the active section is
  always mirrored. The pill indicator glides (`transform` + `width`) instead of
  jumping, and re-measures on resize, orientation change and `document.fonts.ready`.
- **Buttons** are `--primary`, `--success`, `--danger` (filled, with real
  hover/press colours rather than a brightness filter), `--secondary` (glass),
  `--ghost` and `--quiet`. They lift 1 px on hover, compress to 0.975 on press,
  and carry a pointer-tracking specular highlight on fine pointers only.
- **Cards** rise 2 px and gain a hairline on hover — subconscious, not animated
  for its own sake.
- **Chart** keeps subtle grid lines, a stronger zero line, axis labels drawn from
  the data, a halo on the newest sample, toggleable series (legend buttons with
  `aria-pressed`), a glass crosshair tooltip on pointer hover, and the same
  inspection via keyboard (`Home`/`End`/`←`/`→`/`Esc`).
- **Dialog** fades its scrim, then rises and scales 0.96 → 1, traps focus,
  closes on `Esc` or scrim click, and returns focus to the control that opened it.
- **Toasts** are floating glass with an icon, an optional follow-up action
  (e.g. *Download* after a copy) and a dismiss control.
- **Empty / idle states** carry one icon, one line of copy and one action — the
  chart's idle overlay is a single pulsing dot, not a shimmer.

---

## 10. Adding something new

1. If it needs a colour, radius, blur, duration or layer, add a token in
   `css/tokens.css` (in both profiles) first.
2. Pick a material from the table above rather than inventing an opacity.
3. Reuse `.btn`, `.chip`, `.card`, `.panel` — a new component should be the last
   resort, and must then be added to the class-coverage audit.
4. Check it in both themes, at 390 px and 1440 px, with reduced motion on.
