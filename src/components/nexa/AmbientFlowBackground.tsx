import { useEffect, useRef, useSyncExternalStore } from "react";

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

// Centre line of the stream: a broad diagonal S through the lower half.
function spineY(x: number, height: number, t: number) {
  return height * (0.86 - 0.42 * x)
    + height * 0.13 * Math.sin(Math.PI * 2 * (0.7 * x) + t * 0.07)
    + height * 0.05 * Math.sin(Math.PI * 2 * (1.5 * x) - t * 0.045);
}

function drawStream(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, strands: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // Colour runs along the stream: muted blue → cool white → dark NEXA orange.
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(70, 96, 140, 0)");
  gradient.addColorStop(0.18, "rgba(92, 122, 170, 0.9)");
  gradient.addColorStop(0.5, "rgba(214, 222, 236, 1)");
  gradient.addColorStop(0.78, "rgba(196, 120, 64, 0.85)");
  gradient.addColorStop(1, "rgba(150, 80, 40, 0)");
  ctx.strokeStyle = gradient;

  const t = time;

  // Volumetric body: a few wide, faint passes along the spine give the
  // bundle depth without shadowBlur or filters.
  for (const [widthFactor, alpha] of [[0.2, 0.018], [0.11, 0.026], [0.05, 0.034]] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = height * widthFactor;
    ctx.beginPath();
    for (let k = 0; k <= SEGMENTS; k += 1) {
      const x = k / SEGMENTS;
      const y = spineY(x, height, t);
      if (k === 0) ctx.moveTo(x * width, y);
      else ctx.lineTo(x * width, y);
    }
    ctx.stroke();
  }

  const lineWidth = Math.max(0.6, width / 1400);
  for (let i = 0; i < strands; i += 1) {
    const s = strands === 1 ? 0 : i / (strands - 1) - 0.5; // −0.5 … 0.5 across the ribbon
    const centreWeight = 1 - Math.abs(s) * 1.6;
    ctx.globalAlpha = 0.03 + 0.08 * Math.max(0, centreWeight);
    ctx.lineWidth = lineWidth * (1 + Math.max(0, centreWeight) * 0.6);
    ctx.beginPath();
    for (let k = 0; k <= SEGMENTS; k += 1) {
      const x = k / SEGMENTS;
      const spine = spineY(x, height, t);
      // Ribbon width with a slow twist: where the cosine crosses zero the
      // strands converge, giving the folded, volumetric look.
      const envelope = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, x * 1.05 - 0.02))), 0.7);
      const twist = Math.cos(Math.PI * 2 * (0.55 * x) + t * 0.05 + s * 0.35);
      const spread = height * 0.34 * envelope * (0.25 + 0.75 * Math.abs(twist)) * Math.sign(twist || 1);
      // Individual drift per strand keeps the bundle from looking rigid.
      const drift = height * 0.008 * Math.sin(Math.PI * 2 * (2.3 * x) + t * 0.09 + i * 0.9);
      const y = spine + s * spread + drift;
      const px = x * width;
      if (k === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
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
      if (reducedMotion.matches || document.hidden) {
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
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
      reducedMotion.removeEventListener("change", start);
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
