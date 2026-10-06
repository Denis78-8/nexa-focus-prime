import { useEffect, useRef, useSyncExternalStore } from "react";
import { UI_PREFERENCES_EVENT, animationsDisabledByUser } from "@/lib/ui-preferences";

/**
 * Global ambient layer: a slow, ribbon-like stream of fine light strands
 * behind the NEXA UI. Base, far stream and haze are CSS ("Ambient flow
 * background" in styles.css); the strands are drawn on one low-resolution
 * 2D canvas at 30 fps, paused while the tab is hidden and frozen into a single
 * static frame under prefers-reduced-motion.
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
const RENDER_SCALE = 0.6;
const FRAME_INTERVAL_MS = 1000 / 30;
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

/** y of one strand, with its own small speed and phase offset. */
function strandY(stream: StreamSpec, x: number, s: number, index: number, height: number, t: number) {
  const rate = 1 + (((index * 0.618) % 1) - 0.5) * 0.14;
  const envelope = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, x * 1.05 - 0.02))), 0.7);
  // Where the twist cosine crosses zero the strands converge into a fold.
  const twist = Math.cos(Math.PI * 2 * stream.twistFrequency * x + t * stream.twistSpeed * rate + s * 0.35 + stream.phase);
  const spread = height * stream.spread * envelope * (0.25 + 0.75 * Math.abs(twist)) * Math.sign(twist || 1);
  const drift = height * 0.008 * Math.sin(Math.PI * 2 * (2.3 * x) + t * 0.09 * rate + index * 0.9);
  return spineY(stream, x, height, t) + s * spread + drift;
}

function tracePath(ctx: CanvasRenderingContext2D, width: number, from: number, to: number, y: (x: number) => number) {
  ctx.beginPath();
  for (let k = Math.floor(from * SEGMENTS); k <= Math.ceil(to * SEGMENTS); k += 1) {
    const x = k / SEGMENTS;
    if (k === Math.floor(from * SEGMENTS)) ctx.moveTo(x * width, y(x));
    else ctx.lineTo(x * width, y(x));
  }
  ctx.stroke();
}

function drawStream(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, strands: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // Colour runs along the stream: muted blue → cool white → dark orange.
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(70, 96, 140, 0)");
  gradient.addColorStop(0.18, "rgba(92, 122, 170, 0.9)");
  gradient.addColorStop(0.5, "rgba(214, 222, 236, 1)");
  gradient.addColorStop(0.78, "rgba(196, 120, 64, 0.85)");
  gradient.addColorStop(1, "rgba(150, 80, 40, 0)");
  ctx.strokeStyle = gradient;

  const t = time * TIME_SCALE;
  const lineWidth = Math.max(0.6, width / 1400);

  for (const stream of STREAMS) {
    // Volumetric body: a few wide, faint passes along the spine.
    for (const [widthFactor, alpha] of [[0.2, 0.018], [0.11, 0.026], [0.05, 0.034]] as const) {
      ctx.globalAlpha = alpha * stream.intensity;
      ctx.lineWidth = height * widthFactor * (stream.spread / 0.34 + 0.4) / 1.4;
      tracePath(ctx, width, 0, 1, (x) => spineY(stream, x, height, t));
    }

    const count = Math.max(8, Math.round(strands * stream.strandShare));
    for (let i = 0; i < count; i += 1) {
      const s = i / (count - 1) - 0.5; // −0.5 … 0.5 across the ribbon
      const centreWeight = Math.max(0, 1 - Math.abs(s) * 1.6);
      ctx.globalAlpha = (0.03 + 0.08 * centreWeight) * stream.intensity;
      ctx.lineWidth = lineWidth * (1 + centreWeight * 0.6);
      tracePath(ctx, width, 0, 1, (x) => strandY(stream, x, s, i, height, t));
    }

    // Soft travelling highlight: a faint brightening that glides along the
    // core strands, fading in and out at its edges. No flashes.
    const centre = ((t * 0.035 + stream.phase * 0.2) % 1.6) - 0.3;
    const reach = 0.16;
    const from = Math.max(0, centre - reach);
    const to = Math.min(1, centre + reach);
    if (to > from) {
      const pieces = 8;
      for (let i = 0; i < count; i += 1) {
        const s = i / (count - 1) - 0.5;
        const centreWeight = Math.max(0, 1 - Math.abs(s) * 2.4);
        if (centreWeight === 0) continue;
        ctx.lineWidth = lineWidth * 1.2;
        for (let piece = 0; piece < pieces; piece += 1) {
          const a = from + ((to - from) * piece) / pieces;
          const b = from + ((to - from) * (piece + 1)) / pieces;
          const distance = Math.abs((a + b) / 2 - centre) / reach;
          ctx.globalAlpha = 0.045 * centreWeight * stream.intensity * Math.exp(-4 * distance * distance);
          tracePath(ctx, width, a, b, (x) => strandY(stream, x, s, i, height, t));
        }
      }
    }
  }
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

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE;
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
      // Advance by real time but cap gaps (e.g. after a hidden tab) so the
      // stream never jumps.
      elapsed += Math.min(now - (lastTick || now), 100) / 1000;
      lastTick = now;
      lastDraw = now;
      drawStream(ctx, width, height, elapsed, strands);
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
    document.addEventListener("visibilitychange", start);
    reducedMotion.addEventListener("change", start);
    window.addEventListener(UI_PREFERENCES_EVENT, start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
      reducedMotion.removeEventListener("change", start);
      window.removeEventListener(UI_PREFERENCES_EVENT, start);
    };
  }, []);

  return <canvas ref={canvasRef} className="nexa-flow__canvas" />;
}

export function AmbientFlowBackground() {
  const intensity = useSyncExternalStore(subscribe, getIntensity, getServerIntensity);
  return (
    <div aria-hidden className="nexa-flow" data-intensity={intensity}>
      <div className="nexa-flow__layers">
        <div className="nexa-flow__stream nexa-flow__stream--far" />
        <FlowCanvas />
      </div>
      <div className="nexa-flow__haze" />
    </div>
  );
}
