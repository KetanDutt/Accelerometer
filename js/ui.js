/* =========================================================================
   ui.js — presentation layer for the Liquid Glass interface
   -------------------------------------------------------------------------
   Everything here is purely presentational: theme, popovers, the gliding
   navigation indicator, dialogs, scroll reveals and pointer micro-interactions.
   It owns no application state and is safe to remove — js/app.js degrades
   gracefully when `window.AccUI` is absent.

   No dependencies. Exposes a single global: `window.AccUI`.
   ========================================================================= */

(function (global) {
    "use strict";

    var doc = document;
    var root = doc.documentElement;

    var mq = {
        reduced: global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null,
        dark: global.matchMedia ? global.matchMedia("(prefers-color-scheme: dark)") : null,
        fine: global.matchMedia ? global.matchMedia("(hover: hover) and (pointer: fine)") : null
    };

    function onMedia(query, handler) {
        if (!query) return;
        if (typeof query.addEventListener === "function") {
            query.addEventListener("change", handler);
        } else if (typeof query.addListener === "function") {
            query.addListener(handler);
        }
    }

    function matches(query) {
        return !!(query && query.matches);
    }

    function duration(token, fallback) {
        var raw = getComputedStyle(root).getPropertyValue(token).trim();
        var value = parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    /* ---------- Motion preferences -------------------------------------- */
    var MOTION_KEY = "accel-motion";

    var motion = {
        init: function () {
            var stored = null;
            try { stored = global.localStorage.getItem(MOTION_KEY); } catch (err) { stored = null; }
            if (stored === "reduced") root.setAttribute("data-motion", "reduced");
            this.syncControls();
        },

        reduced: function () {
            return root.getAttribute("data-motion") === "reduced" || matches(mq.reduced);
        },

        set: function (reduced) {
            if (reduced) root.setAttribute("data-motion", "reduced");
            else root.removeAttribute("data-motion");
            try {
                global.localStorage.setItem(MOTION_KEY, reduced ? "reduced" : "full");
            } catch (err) { /* storage optional */ }
            this.syncControls();
        },

        syncControls: function () {
            var on = root.getAttribute("data-motion") === "reduced";
            Array.prototype.forEach.call(doc.querySelectorAll("[data-motion-toggle]"), function (node) {
                node.setAttribute("aria-checked", on ? "true" : "false");
            });
            Array.prototype.forEach.call(doc.querySelectorAll("[data-motion-hint]"), function (node) {
                node.textContent = on ? "On" : "Off";
            });
        }
    };

    /* ---------- Theme ---------------------------------------------------- */
    var THEME_KEY = "accel-theme";
    var themeListeners = [];

    function readStoredTheme() {
        try {
            return global.localStorage.getItem(THEME_KEY);
        } catch (err) {
            return null;
        }
    }

    function writeStoredTheme(value) {
        try {
            global.localStorage.setItem(THEME_KEY, value);
        } catch (err) {
            /* Private browsing / storage disabled — the session still works. */
        }
    }

    var theme = {
        mode: "auto",

        init: function () {
            var stored = readStoredTheme();
            this.mode = (stored === "light" || stored === "dark") ? stored : "auto";
            this.syncSystem();
            root.setAttribute("data-theme", this.mode);

            var self = this;
            onMedia(mq.dark, function () {
                if (self.mode !== "auto") return;
                self.syncSystem();
                self.emit();
            });
        },

        syncSystem: function () {
            root.setAttribute("data-system", matches(mq.dark) ? "dark" : "light");
        },

        resolved: function () {
            if (this.mode !== "auto") return this.mode;
            return matches(mq.dark) ? "dark" : "light";
        },

        set: function (mode) {
            if (mode !== "auto" && mode !== "light" && mode !== "dark") return;
            this.mode = mode;
            writeStoredTheme(mode);
            root.setAttribute("data-theme", mode);
            this.syncSystem();
            this.emit();
        },

        onChange: function (fn) {
            themeListeners.push(fn);
        },

        emit: function () {
            var resolved = this.resolved();
            themeListeners.forEach(function (fn) {
                try { fn(resolved, theme.mode); } catch (err) { /* listener errors must not break the app */ }
            });
        }
    };

    /* ---------- Appearance menu (layer 4 popover) ------------------------- */
    function initMenus() {
        var menus = doc.querySelectorAll("[data-menu]");

        Array.prototype.forEach.call(menus, function (menu) {
            var trigger = menu.querySelector("[data-menu-trigger]");
            var panel = menu.querySelector("[data-menu-panel]");
            if (!trigger || !panel) return;

            var open = false;
            var closeTimer = null;

            function items() {
                return Array.prototype.slice.call(panel.querySelectorAll("[role^='menuitem']"));
            }

            function focusItem(index) {
                var list = items();
                if (!list.length) return;
                var next = (index + list.length) % list.length;
                list[next].focus();
            }

            function setOpen(next) {
                if (next === open) return;
                open = next;
                clearTimeout(closeTimer);
                trigger.setAttribute("aria-expanded", open ? "true" : "false");

                if (open) {
                    panel.hidden = false;
                    panel.classList.remove("is-closing");
                    panel.classList.add("is-open");
                    var checked = panel.querySelector("[aria-checked='true']") || items()[0];
                    if (checked) checked.focus();
                    return;
                }

                panel.classList.remove("is-open");
                if (motion.reduced()) {
                    panel.hidden = true;
                    panel.classList.remove("is-closing");
                    return;
                }
                panel.classList.add("is-closing");
                closeTimer = setTimeout(function () {
                    panel.hidden = true;
                    panel.classList.remove("is-closing");
                }, duration("--dur-1", 120) + 40);
            }

            trigger.addEventListener("click", function (event) {
                event.stopPropagation();
                setOpen(!open);
            });

            trigger.addEventListener("keydown", function (event) {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpen(true);
                }
            });

            panel.addEventListener("click", function (event) {
                event.stopPropagation();
                if (!event.target.closest) return;

                // The motion switch stays open: it is a toggle, not a choice.
                var toggle = event.target.closest("[data-motion-toggle]");
                if (toggle) {
                    motion.set(toggle.getAttribute("aria-checked") !== "true");
                    toggle.focus();
                    return;
                }

                var option = event.target.closest("[data-theme-option]");
                if (!option) return;
                var value = option.getAttribute("data-theme-option");
                Array.prototype.forEach.call(panel.querySelectorAll("[data-theme-option]"), function (node) {
                    node.setAttribute("aria-checked", node === option ? "true" : "false");
                });
                theme.set(value);
                setOpen(false);
                trigger.focus();
            });

            panel.addEventListener("keydown", function (event) {
                var list = items();
                var index = list.indexOf(doc.activeElement);

                if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    trigger.focus();
                } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusItem(index + 1);
                } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusItem(index - 1);
                } else if (event.key === "Home") {
                    event.preventDefault();
                    focusItem(0);
                } else if (event.key === "End") {
                    event.preventDefault();
                    focusItem(list.length - 1);
                } else if (event.key === "Tab") {
                    // Keep focus inside the popover while it is open.
                    event.preventDefault();
                    focusItem(index + (event.shiftKey ? -1 : 1));
                }
            });

            doc.addEventListener("click", function () {
                if (open) setOpen(false);
            });

            doc.addEventListener("keydown", function (event) {
                if (event.key === "Escape" && open) {
                    setOpen(false);
                    trigger.focus();
                }
            });
        });
    }

    /* ---------- Gliding navigation indicator ------------------------------ */
    var indicators = [];

    function initIndicators() {
        var navs = doc.querySelectorAll("[data-nav], [data-dock]");

        Array.prototype.forEach.call(navs, function (nav) {
            var indicator = nav.querySelector("[data-indicator]");
            var links = Array.prototype.slice.call(nav.querySelectorAll(".nav-link"));
            if (!indicator || !links.length) return;

            var entry = {
                nav: nav,
                indicator: indicator,
                links: links,
                update: function () {
                    // Hidden navigations (segmented bar on phones, dock on desktop)
                    // measure as 0 — keep the previous geometry instead of collapsing.
                    if (!nav.offsetWidth) return;
                    var active = links.filter(function (link) {
                        return link.classList.contains("is-active");
                    })[0] || links[0];
                    if (!active || !active.offsetWidth) return;
                    indicator.style.setProperty("--ind-w", active.offsetWidth + "px");
                    indicator.style.setProperty("--ind-x", active.offsetLeft + "px");
                    indicator.style.setProperty("--ind-opacity", "1");
                    indicator.style.opacity = "1";
                }
            };

            indicators.push(entry);

            if (global.ResizeObserver) {
                var observer = new ResizeObserver(function () { entry.update(); });
                observer.observe(nav);
                links.forEach(function (link) { observer.observe(link); });
            }
        });

        var frame = null;
        function refresh() {
            if (frame) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                indicators.forEach(function (entry) { entry.update(); });
            });
        }

        global.addEventListener("resize", refresh, { passive: true });
        global.addEventListener("orientationchange", refresh);
        // Fonts settling changes label widths; re-measure once they are ready.
        if (doc.fonts && typeof doc.fonts.ready.then === "function") {
            doc.fonts.ready.then(refresh);
        }

        refresh();
        api.refreshIndicators = refresh;
    }

    /* ---------- Scroll-reactive chrome ------------------------------------ */
    function initScrollState() {
        var ticking = false;

        function update() {
            ticking = false;
            doc.body.classList.toggle("is-scrolled", global.scrollY > 10);
        }

        global.addEventListener("scroll", function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        }, { passive: true });

        update();
    }

    /* ---------- Scroll reveals -------------------------------------------- */
    function initReveal() {
        var nodes = Array.prototype.slice.call(doc.querySelectorAll("[data-reveal]"));
        if (!nodes.length) return;

        if (motion.reduced() || !("IntersectionObserver" in global)) {
            nodes.forEach(function (node) { node.classList.add("is-visible"); });
            return;
        }

        // Stagger siblings so a section reads as one composition, not a queue.
        var groups = new Map();
        nodes.forEach(function (node) {
            var parent = node.parentElement;
            if (!groups.has(parent)) groups.set(parent, []);
            groups.get(parent).push(node);
        });
        groups.forEach(function (group) {
            group.forEach(function (node, index) {
                node.style.setProperty("--reveal-delay", Math.min(index, 4) * 70 + "ms");
            });
        });

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

        nodes.forEach(function (node) { observer.observe(node); });
    }

    /* ---------- Dialog (layer 5) ------------------------------------------ */
    var dialog = {
        el: null,
        scrim: null,
        confirmBtn: null,
        cancelBtn: null,
        lastFocus: null,
        isOpen: false,
        onConfirm: null,

        init: function (onConfirm) {
            this.el = doc.querySelector("[data-dialog]");
            this.scrim = doc.querySelector("[data-dialog-scrim]");
            this.confirmBtn = this.el ? this.el.querySelector("[data-dialog-confirm]") : null;
            this.cancelBtn = this.el ? this.el.querySelector("[data-dialog-cancel]") : null;
            this.onConfirm = onConfirm;
            if (!this.el || !this.scrim) return;

            var self = this;
            if (this.confirmBtn) {
                this.confirmBtn.addEventListener("click", function () {
                    var callback = self.onConfirm;
                    self.close();
                    if (typeof callback === "function") callback();
                });
            }
            if (this.cancelBtn) this.cancelBtn.addEventListener("click", function () { self.close(); });
            this.scrim.addEventListener("click", function () { self.close(); });
            this.el.addEventListener("keydown", function (event) { self.onKeydown(event); });
        },

        focusables: function () {
            return Array.prototype.slice.call(this.el.querySelectorAll(
                "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
            )).filter(function (node) { return !node.disabled && node.offsetParent !== null; });
        },

        onKeydown: function (event) {
            if (event.key === "Escape") {
                event.preventDefault();
                this.close();
                return;
            }
            if (event.key !== "Tab") return;

            var list = this.focusables();
            if (!list.length) return;
            var first = list[0];
            var last = list[list.length - 1];

            if (event.shiftKey && doc.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && doc.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        },

        open: function () {
            if (!this.el || this.isOpen) return;
            this.isOpen = true;
            this.lastFocus = doc.activeElement;
            this.el.hidden = false;
            this.scrim.hidden = false;

            var self = this;
            requestAnimationFrame(function () {
                self.el.classList.add("is-open");
                self.scrim.classList.add("is-open");
                var target = self.cancelBtn || self.focusables()[0];
                if (target) target.focus();
            });
        },

        close: function () {
            if (!this.el || !this.isOpen) return;
            this.isOpen = false;
            this.el.classList.remove("is-open");
            this.scrim.classList.remove("is-open");

            if (this.lastFocus && typeof this.lastFocus.focus === "function") {
                this.lastFocus.focus();
            }

            var el = this.el;
            var scrim = this.scrim;
            if (motion.reduced()) {
                el.hidden = true;
                scrim.hidden = true;
                return;
            }
            setTimeout(function () {
                el.hidden = true;
                scrim.hidden = true;
            }, duration("--dur-3", 260) + 60);
        }
    };

    /* ---------- Pointer micro-interaction ---------------------------------
       A soft specular highlight follows the pointer across buttons. Bound
       only for fine pointers and throttled to one write per frame.        */
    function initSpecular() {
        if (!matches(mq.fine)) return;

        var frame = null;
        var pending = null;

        doc.addEventListener("pointermove", function (event) {
            pending = event;
            if (frame) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                var target = pending && pending.target;
                var btn = target && target.closest ? target.closest(".btn") : null;
                if (!btn || btn.disabled) return;
                var rect = btn.getBoundingClientRect();
                if (!rect.width || !rect.height) return;
                btn.style.setProperty("--px", (((pending.clientX - rect.left) / rect.width) * 100).toFixed(1) + "%");
                btn.style.setProperty("--py", (((pending.clientY - rect.top) / rect.height) * 100).toFixed(1) + "%");
            });
        }, { passive: true });
    }

    /* ---------- Runtime helpers used by app.js ---------------------------- */
    function markEntering(node) {
        if (!node || motion.reduced()) return;
        node.classList.remove("is-entering");
        // Force a style flush so the animation restarts when re-shown.
        void node.offsetWidth;
        node.classList.add("is-entering");
    }

    var api = {
        theme: theme,
        motion: motion,
        dialog: dialog,
        markEntering: markEntering,
        refreshIndicators: function () {
            indicators.forEach(function (entry) { entry.update(); });
        },
        reducedMotion: function () { return motion.reduced(); },
        onThemeChange: function (fn) { theme.onChange(fn); }
    };

    function init() {
        theme.init();
        motion.init();
        initMenus();
        initIndicators();
        initScrollState();
        initReveal();
        initSpecular();
    }

    if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    global.AccUI = api;
})(window);
