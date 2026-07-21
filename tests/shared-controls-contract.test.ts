import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");

test("shared controls expose one complete visual and keyboard state contract", () => {
  const controls = read("src/renderer/components/Controls.tsx");
  const css = read("src/renderer/styles.css");

  assert.match(controls, /"primary" \| "secondary" \| "ghost" \| "danger"/);
  assert.match(controls, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(controls, /data-control="input"/);
  assert.match(controls, /role="radiogroup"/);
  assert.match(controls, /role="radio"/);
  assert.match(controls, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(controls, /event\.key === "ArrowRight"/);
  assert.match(controls, /event\.key === "Home"/);
  assert.match(controls, /event\.key === "End"/);

  assert.match(css, /\.control-button--primary/);
  assert.match(css, /\.control-button--secondary/);
  assert.match(css, /\.control-button--ghost/);
  assert.match(css, /\.control-button--danger/);
  assert.match(css, /\.control-button:active:not\(:disabled\)[\s\S]*scale\(0\.97\)/);
  assert.match(css, /\.control-input:focus-visible[\s\S]*--study-gold-focus/);
  assert.match(css, /\.control-segment\[aria-checked="true"\]/);
  assert.match(css, /\.control-card/);
  assert.match(css, /\.control-menu-item/);
});

test("anchored popovers are lightweight, named, focusable, and modal only by request", () => {
  const popover = read("src/renderer/components/Popover.tsx");
  const css = read("src/renderer/styles.css");

  assert.match(popover, /ariaLabel: string/);
  assert.match(popover, /modal = false/);
  assert.match(popover, /initialFocusRef\?: React\.RefObject<HTMLElement \| null>/);
  assert.match(popover, /preferred && panel\.contains\(preferred\) \? preferred : first \?\? panel/);
  assert.match(popover, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(popover, /if \(!modal \|\| e\.key !== "Tab" \|\| !panelRef\.current \|\| !ownsKeyboard\) return/);
  assert.match(popover, /aria-modal=\{modal \|\| undefined\}/);
  assert.match(popover, /data-floating-layer="popover"/);
  assert.match(popover, /data-placement=\{position\.placement\}/);
  assert.match(popover, /boundaryRect\?: PopoverBoundaryRect/);
  assert.match(popover, /resolveBoundary\(boundaryRect\)/);
  assert.match(popover, /width: position\.width/);
  assert.match(popover, /maxHeight: position\.maxHeight/);
  assert.match(popover, /requestedMaxHeight != null \|\| boundaryRect != null/);
  assert.match(popover, /data-position-boundary=\{boundaryRect \? "custom" : "viewport"\}/);
  // Resize closes only on a real width change; height-only resizes (mobile
  // browser chrome showing/hiding during scroll) must not strand the user.
  assert.match(popover, /window\.addEventListener\("resize", handleResize\)/);
  assert.match(popover, /if \(window\.innerWidth === lastWidth\) return/);
  // Escape ownership comes from the shared layer registry, not DOM order.
  assert.match(popover, /const ownsKeyboard = isTopLayer\(layerRef\.current\)/);
  assert.doesNotMatch(popover, /querySelectorAll<HTMLElement>\("\[data-floating-layer\]"\)/);
  assert.match(popover, /e\.stopImmediatePropagation\(\)/);
  assert.match(popover, /onPointerDown=\{\(event\) => \{[\s\S]{0,180}event\.preventDefault\(\);[\s\S]{0,100}event\.stopPropagation\(\);/);
  assert.match(popover, /onClick=\{\(event\) => \{[\s\S]{0,180}event\.stopPropagation\(\);[\s\S]{0,100}onClose\(\);/);
  assert.doesNotMatch(popover, /onPointerDown=\{onClose\}/);

  assert.match(css, /\.popover-scrim\s*\{[\s\S]*background: transparent/);
  assert.match(css, /\.popover-scrim\.is-soft/);
  assert.doesNotMatch(css, /\/\* Soft scrim behind popovers/);
  assert.match(css, /\.popover-panel\s*\{[\s\S]*border-radius: var\(--radius-md\)/);
  assert.match(css, /\.popover-panel\s*\{\s*--popover-enter-y: -3px;[\s\S]*animation: popover-in 180ms/);
  assert.match(css, /\.popover-panel\[data-placement="top"\]\s*\{\s*--popover-enter-y: 3px;\s*transform-origin: bottom left;\s*\}/);
  assert.match(css, /@keyframes popover-in\s*\{\s*from \{ opacity: 0; transform: translateY\(var\(--popover-enter-y\)\) scale\(0\.985\); \}/);
  assert.doesNotMatch(css, /\.popover-panel\[data-placement="top"\][^{]*\{[^}]*animation-name:/);
  assert.doesNotMatch(css, /@keyframes popover-in-top/);
});

test("tooltips replace native title-only hints for compact reading actions", () => {
  const tooltip = read("src/renderer/components/Tooltip.tsx");
  const comfort = read("src/renderer/components/ReadingComfort.tsx");
  const theme = read("src/renderer/components/ThemePicker.tsx");

  assert.match(tooltip, /HOVER_DELAY_MS = 420/);
  assert.match(tooltip, /role="tooltip"/);
  assert.match(tooltip, /"aria-describedby": describedBy/);
  assert.match(tooltip, /onFocusCapture=\{\(\) => showAfter\(120\)\}/);
  assert.match(tooltip, /event\.key === "Escape"/);
  assert.match(comfort, /<Tooltip label="Reading layout">/);
  assert.match(comfort, /function TextLayoutIcon/);
  assert.doesNotMatch(comfort, /reading-comfort-size-tag|function AaIcon/);
  assert.match(comfort, /shortcut="F"/);
  assert.match(theme, /<Tooltip label=\{`Reading atmosphere/);
});

test("toasts are typed, announced, timed, dismissible, and clean up timers", () => {
  const toast = read("src/renderer/components/Toast.tsx");
  const page = read("src/renderer/components/ScripturePage.tsx");
  const css = read("src/renderer/styles.css");

  assert.match(toast, /"neutral" \| "success" \| "warning" \| "error"/);
  assert.match(toast, /aria-live="polite"/);
  assert.match(toast, /role=\{toast\.tone === "error" \? "alert" : "status"\}/);
  assert.match(toast, /aria-label="Dismiss notification"/);
  assert.match(toast, /className="toast-progress"/);
  assert.match(css, /\.toast-progress \{[^}]*height:\s*1px;[^}]*var\(--text-primary\) 16%/);
  assert.doesNotMatch(css, /\.toast-progress \{[^}]*var\(--toast-tone\)/);
  assert.match(toast, /for \(const timer of autoTimers\.current\.values\(\)\) window\.clearTimeout\(timer\)/);
  assert.match(page, /Failed to create highlight", undefined, undefined, \{ tone: "error" \}/);
  assert.match(page, /Saved “\$\{title\}”`, undefined, undefined, \{ tone: "success" \}/);
});

test("note capture contains and restores focus while using shared fields and actions", () => {
  const capture = read("src/renderer/components/NoteCapture.tsx");

  assert.match(capture, /aria-modal="true"/);
  assert.match(capture, /data-floating-layer="dialog"/);
  assert.match(capture, /e\.key !== "Tab"/);
  assert.match(capture, /target\?\.isConnected/);
  assert.match(capture, /\.verse-line\[data-verse=/);
  assert.match(capture, /<ControlInput/);
  assert.match(capture, /<ControlTextarea/);
  assert.match(capture, /variant="primary"/);
  assert.match(capture, /busy=\{saving\}/);
});
