import { useEffect, useRef, useSyncExternalStore } from "react";
import { UI_PREFERENCES_EVENT, animationsDisabledByUser } from "@/lib/ui-preferences";

/**
 * Global ambient layer: a slow, ribbon-like stream of fine light strands
 * behind the NEXA UI. Base, far stream and haze are CSS ("Ambient flow
 * background" in styles.css); the strands are drawn on one low-resolution
 * 2D canvas at 20 fps, paused while the tab is hidden or the page is being
 * scrolled, and frozen into a single static frame under prefers-reduced-motion.
 * Open dialogs and focused forms dim it through data attributes on the root
 * (set here, so no global :has() selector re-evaluates the whole document).
 * Screens that should feel quieter call useAmbientIntensity("calm").
 */
type Intensity = "normal" | "calm";

let calmRequests = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getIntensity = (): Intensity => (calmRequests > 0 ? "calm" : "normal");
const getServerIntensity = (): Intensity => "normal";

/** Lowers the background intensity while the calling component is mounted. */
export function useAmbientIntensity(intensity: Intensity) {
  useEffect(() => {
    if (intensity !== "calm") return;
    calmRequests += 1;
    listeners.forEach((listener) => listener());
    return () => {
      calmRequests -= 1;
      listeners.forEach((listener) => listener());
    };
  }, [intensity]);
}

// Rendering resolution relative to CSS pixels. The upscaled canvas gives the
// strands a natural softness without filter blur.
// Retina is capped at 1.5× so a 2× screen renders ~60% fewer pixels; the
// strands are soft by design, so the lower resolution is not visible.
const RENDER_SCALE = 0.5;
const MAX_PIXEL_RATIO = 1.5;
const FRAME_INTERVAL_MS = 1000 / 20;
// Drawing resumes this long after the last scroll event.
const SCROLL_IDLE_MS = 160;
const SEGMENTS = 72;
// Static pose used for reduced motion and as the starting phase.
const STATIC_TIME = 42;

// Global speed of all motion; ~30% livelier than the original single stream
// while every period stays in the tens of seconds.
const TIME_SCALE = 1.3;

type Harmonic = { amplitude: number; frequency: number; speed: number };

type StreamSpec = {
  /** Vertical position (fraction of height) at the left edge and its fall to the right. */
  base: number;
  slope: number;
  /** Three harmonics; the third is very slow and long, so the shape keeps changing. */
  harmonics: [Harmonic, Harmonic, Harmonic];
  /** Ribbon half-width as a fraction of height, and the twist rate. */
  spread: number;
  twistFrequency: number;
  twistSpeed: number;
  /** Overall brightness relative to the main stream and the share of strands. */
  intensity: number;
  strandShare: number;
  /** Phase offset so the two streams never move in lockstep. */
  phase: number;
};

// Two linked streams: a broad main ribbon and a thinner, dimmer companion that
// drifts on its own trajectory and periodically approaches and separates.
const STREAMS: StreamSpec[] = [
  {
    base: 0.86, slope: 0.42,
    harmonics: [
      { amplitude: 0.13, frequency: 0.7, speed: 0.07 },
      { amplitude: 0.05, frequency: 1.5, speed: -0.045 },
      { amplitude: 0.035, frequency: 0.35, speed: 0.023 },
    ],
    spread: 0.34, twistFrequency: 0.55, twistSpeed: 0.05,
    intensity: 1, strandShare: 0.68, phase: 0,
  },
  {
    base: 0.68, slope: 0.3,
    harmonics: [
      { amplitude: 0.09, frequency: 0.9, speed: -0.055 },
      { amplitude: 0.04, frequency: 1.9, speed: 0.06 },
      { amplitude: 0.03, frequency: 0.45, speed: 0.019 },
    ],
    spread: 0.16, twistFrequency: 0.8, twistSpeed: -0.043,
    intensity: 0.55, strandShare: 0.32, phase: 2.1,
  },
];

// Centre line of a stream. The first harmonic's amplitude itself breathes
// slowly, so the curve never settles into a fixed rhythm.
function spineY(stream: StreamSpec, x: number, height: number, t: number) {
  const [h1, h2, h3] = stream.harmonics;
  const breathe = 1 + 0.18 * Math.sin(t * 0.031 + stream.phase);
  return height * (stream.base - stream.slope * x)
    + height * h1.amplitude * breathe * Math.sin(Math.PI * 2 * h1.frequency * x + t * h1.speed + stream.phase)
    + height * h2.amplitude * Math.sin(Math.PI * 2 * h2.frequency * x + t * h2.speed + stream.phase * 0.7)
    + height * h3.amplitude * Math.sin(Math.PI * 2 * h3.frequency * x + t * h3.speed + stream.phase * 1.3);
}

// Envelope depends only on x: computed once for the SEGMENTS grid.
const ENVELOPE = Array.from({ length: SEGMENTS + 1 }, (_, k) =>
  Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (k / SEGMENTS) * 1.05 - 0.02))), 0.7));
// Spine of each stream for the current frame, sampled on the same grid, so
// every strand reuses it instead of re-evaluating the harmonics.
const spineCache = STREAMS.map(() => new Float64Array(SEGMENTS + 1));

/** y of one strand at grid point k, with its own small speed and phase offset. */
function strandY(stream: StreamSpec, spine: Float64Array, k: number, s: number, index: number, height: number, t: number) {
  const x = k / SEGMENTS;
  const rate = 1 + (((index * 0.618) % 1) - 0.5) * 0.14;
  const envelope = ENVELOPE[k]!;
  // Where the twist cosine crosses zero the strands converge into a fold.
  const twist = Math.cos(Math.PI * 2 * stream.twistFrequency * x + t * stream.twistSpeed * rate + s * 0.35 + stream.phase);
  const spread = height * stream.spread * envelope * (0.25 + 0.75 * Math.abs(twist)) * Math.sign(twist || 1);
  const drift = height * 0.008 * Math.sin(Math.PI * 2 * (2.3 * x) + t * 0.09 * rate + index * 0.9);
  return spine[k]! + s * spread + drift;
}

function tracePath(ctx: CanvasRenderingContext2D, width: number, from: number, to: number, y: (k: number) => number) {
  ctx.beginPath();
  const first = Math.floor(from * SEGMENTS);
  for (let k = first; k <= Math.ceil(to * SEGMENTS); k += 1) {
    if (k === first) ctx.moveTo((k / SEGMENTS) * width, y(k));
    else ctx.lineTo((k / SEGMENTS) * width, y(k));
  }
  ctx.stroke();
}

// Colour stops of the stream (x, r, g, b, a): muted blue → cool white → dark orange.
const COLOR_STOPS: [number, number, number, number, number][] = [
  [0, 70, 96, 140, 0],
  [0.18, 92, 122, 170, 0.9],
  [0.5, 214, 222, 236, 1],
  [0.78, 196, 120, 64, 0.85],
  [1, 150, 80, 40, 0],
];

function colorAt(x: number): [number, number, number, number] {
  for (let i = 1; i < COLOR_STOPS.length; i += 1) {
    const b = COLOR_STOPS[i]!;
    if (x <= b[0]) {
      const a = COLOR_STOPS[i - 1]!;
      const f = (x - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f];
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]!;
  return [last[1], last[2], last[3], last[4]];
}

function drawStream(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, strands: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // Colour runs along the stream: muted blue → cool white → dark orange.
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (const [x, r, g, b, a] of COLOR_STOPS) gradient.addColorStop(x, `rgba(${r}, ${g}, ${b}, ${a})`);
  ctx.strokeStyle = gradient;

  const t = time * TIME_SCALE;
  const lineWidth = Math.max(0.6, width / 1400);

  STREAMS.forEach((stream, streamIndex) => {
    const spine = spineCache[streamIndex]!;
    for (let k = 0; k <= SEGMENTS; k += 1) spine[k] = spineY(stream, k / SEGMENTS, height, t);

    // Volumetric body: a few wide, faint passes along the spine.
    for (const [widthFactor, alpha] of [[0.2, 0.018], [0.11, 0.026], [0.05, 0.034]] as const) {
      ctx.globalAlpha = alpha * stream.intensity;
      ctx.lineWidth = height * widthFactor * (stream.spread / 0.34 + 0.4) / 1.4;
      tracePath(ctx, width, 0, 1, (k) => spine[k]!);
    }

    const count = Math.max(8, Math.round(strands * stream.strandShare));
    for (let i = 0; i < count; i += 1) {
      const s = i / (count - 1) - 0.5; // −0.5 … 0.5 across the ribbon
      const centreWeight = Math.max(0, 1 - Math.abs(s) * 1.6);
      ctx.globalAlpha = (0.03 + 0.08 * centreWeight) * stream.intensity;
      ctx.lineWidth = lineWidth * (1 + centreWeight * 0.6);
      tracePath(ctx, width, 0, 1, (k) => strandY(stream, spine, k, s, i, height, t));
    }

    // Soft travelling highlight: a faint brightening that glides along the
    // core strands, fading in and out at its edges. No flashes.
    const centre = ((t * 0.035 + stream.phase * 0.2) % 1.6) - 0.3;
    const reach = 0.16;
    const from = Math.max(0, centre - reach);
    const to = Math.min(1, centre + reach);
    if (to > from) {
      // One stroke per strand: the bell-shaped fade along the highlight is
      // baked into a horizontal gradient (stream colour × Gaussian), instead
      // of eight separately stroked pieces with their own alpha.
      const highlight = ctx.createLinearGradient(from * width, 0, to * width, 0);
      const steps = 8;
      for (let step = 0; step <= steps; step += 1) {
        const x = from + ((to - from) * step) / steps;
        const distance = Math.abs(x - centre) / reach;
        const [r, g, b, a] = colorAt(x);
        highlight.addColorStop(step / steps, `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a * Math.exp(-4 * distance * distance)})`);
      }
      ctx.strokeStyle = highlight;
      ctx.lineWidth = lineWidth * 1.2;
      for (let i = 0; i < count; i += 1) {
        const s = i / (count - 1) - 0.5;
        const centreWeight = Math.max(0, 1 - Math.abs(s) * 2.4);
        if (centreWeight === 0) continue;
        ctx.globalAlpha = 0.045 * centreWeight * stream.intensity;
        tracePath(ctx, width, from, to, (k) => strandY(stream, spine, k, s, i, height, t));
      }
      ctx.strokeStyle = gradient;
    }
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function FlowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let strands = 96;
    let frame = 0;
    let lastDraw = 0;
    let elapsed = STATIC_TIME;
    let lastTick = 0;
    let scrollingUntil = 0;

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * RENDER_SCALE;
      width = Math.max(1, Math.round(window.innerWidth * scale));
      height = Math.max(1, Math.round(window.innerHeight * scale));
      canvas.width = width;
      canvas.height = height;
      strands = window.innerWidth < 768 ? 56 : 96;
      drawStream(ctx, width, height, elapsed, strands);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      // While the page scrolls the stream holds still (time does not advance),
      // so scrolling gets the main thread and GPU to itself.
      if (now < scrollingUntil) {
        lastTick = now;
        return;
      }
      // Advance by real time but cap gaps (e.g. after a hidden tab) so the
      // stream never jumps.
      elapsed += Math.min(now - (lastTick || now), 100) / 1000;
      lastTick = now;
      lastDraw = now;
      drawStream(ctx, width, height, elapsed, strands);
    };

    const onScroll = () => {
      scrollingUntil = performance.now() + SCROLL_IDLE_MS;
    };

    const start = () => {
      cancelAnimationFrame(frame);
      lastTick = 0;
      // Static frame for reduced motion, a hidden tab or animations switched off in Settings.
      if (reducedMotion.matches || document.hidden || animationsDisabledByUser()) {
        drawStream(ctx, width, height, elapsed, strands);
        return;
      }
      frame = requestAnimationFrame(loop);
    };

    resize();
    start();
    window.addEventListener("resize", resize);
    // Capture phase: also catches scrolling inside nested scroll containers.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", start);
    reducedMotion.addEventListener("change", start);
    window.addEventListener(UI_PREFERENCES_EVENT, start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", start);
      reducedMotion.removeEventListener("change", start);
      window.removeEventListener(UI_PREFERENCES_EVENT, start);
    };
  }, []);

  return <canvas ref={canvasRef} className="nexa-flow__canvas" />;
}

/**
 * Dims the stream while a dialog is open or a form field has focus. Replaces
 * the former body:has(...) selectors: the state is written straight to the
 * root as data attributes (no React re-render), and only focus changes and
 * top-level portal mounts are observed.
 */
function useAutomaticDimming(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const setFlag = (name: string, on: boolean) => {
      if (on) root.setAttribute(name, "");
      else root.removeAttribute(name);
    };
    // A focused field that is removed from the DOM fires no focusout, so while
    // the flag is on (and only then) node removals re-check it.
    const removals = new MutationObserver(() => syncForm());
    const syncForm = () => {
      const active = document.activeElement;
      const inForm = Boolean(active instanceof Element && active.isConnected && active.closest("form"));
      setFlag("data-form-focus", inForm);
      removals.disconnect();
      if (inForm) removals.observe(document.body, { childList: true, subtree: true });
    };
    // Radix dialogs mount in a portal (a direct child of body) and flip
    // data-state on close; both changes are covered by these two observers.
    const syncDialog = () => setFlag("data-dialog-open", Boolean(document.querySelector('[role="dialog"][data-state="open"]')));
    const states = new MutationObserver(syncDialog);
    const watchStates = () => {
      states.disconnect();
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => states.observe(dialog, { attributes: true, attributeFilter: ["data-state"] }));
      syncDialog();
    };
    const portals = new MutationObserver(watchStates);
    portals.observe(document.body, { childList: true });
    const onFocusChange = () => queueMicrotask(syncForm);
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    syncForm();
    watchStates();
    return () => {
      portals.disconnect();
      states.disconnect();
      removals.disconnect();
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
    };
  }, [rootRef]);
}

export function AmbientFlowBackground() {
  const intensity = useSyncExternalStore(subscribe, getIntensity, getServerIntensity);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutomaticDimming(rootRef);
  return (
    <div ref={rootRef} aria-hidden className="nexa-flow" data-intensity={intensity}>
      <div className="nexa-flow__layers">
        <div className="nexa-flow__stream nexa-flow__stream--far" />
        <FlowCanvas />
      </div>
      <div className="nexa-flow__haze" />
    </div>
  );
}
