import { useId, type CSSProperties } from "react";

/**
 * LUNO DIGITAL backdrop: a graphite night with a lunar eclipse — a dark disc
 * whose rim glows in the brand orange gradient and is split by the two cuts of
 * the logo's "O" (at 3 and 6 o'clock), with a soft light gliding around it, a
 * faint "digital" dot grid and, on sign-in, the logo's pixel squares.
 *
 * One material for both places: "auth" is large and expressive (rising from
 * behind the sign-in panel), "app" is small and dim in the top-right corner,
 * out of the way of content. Static SVG + CSS ("LUNO backdrop" in styles.css);
 * motion is transform/opacity on a few layers and stops under
 * prefers-reduced-motion and the Settings animation switch.
 */

const CENTER = 100;
const RADIUS = 80;
// Width of each cut in degrees: the logo's "O" is split at 3 and 6 o'clock.
const CUT = 2.6;

function point(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return `${(CENTER + RADIUS * Math.cos(radians)).toFixed(2)} ${(CENTER + RADIUS * Math.sin(radians)).toFixed(2)}`;
}

function arc(from: number, to: number) {
  return `M ${point(from)} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

// Large arc: 6 o'clock → 9 → 12 → 3 o'clock; small arc: the bottom-right quarter.
const RIM_ARCS = [arc(90 + CUT, 360 - CUT), arc(CUT, 90 - CUT)];

// The logo's four pixel squares, in % of the cluster box (top-right of the rim).
const PIXELS: { left: string; top: string; size: string; duration: string; delay: string }[] = [
  { left: "0%", top: "24%", size: "22%", duration: "7s", delay: "-2s" },
  { left: "30%", top: "0%", size: "40%", duration: "9s", delay: "-5s" },
  { left: "78%", top: "36%", size: "20%", duration: "8s", delay: "-1s" },
  { left: "44%", top: "54%", size: "28%", duration: "10s", delay: "-6s" },
];

export function LunoBackdrop({ variant }: { variant: "auth" | "app" }) {
  const gradientId = `luno-rim-${useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden className={`luno-backdrop luno-backdrop--${variant}`}>
      <div className="luno-backdrop__grid" />
      <div className="luno-eclipse">
        <div className="luno-eclipse__body">
          <div className="luno-eclipse__haze" />
          <div className="luno-eclipse__glow" />
          <div className="luno-eclipse__disc" />
          <svg className="luno-eclipse__rim" viewBox="0 0 200 200" fill="none">
            <defs>
              {/* Same direction as the logo's "O": deep orange bottom-left → amber top-right. */}
              <linearGradient
                id={gradientId}
                x1="30"
                y1="175"
                x2="170"
                y2="25"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#FF5A00" />
                <stop offset="1" stopColor="#FFA21A" />
              </linearGradient>
            </defs>
            {RIM_ARCS.map((d) => (
              <path
                key={`bloom-${d}`}
                d={d}
                stroke={`url(#${gradientId})`}
                strokeWidth="5"
                strokeOpacity="0.14"
              />
            ))}
            {RIM_ARCS.map((d) => (
              <path key={d} d={d} stroke={`url(#${gradientId})`} strokeWidth="1.3" />
            ))}
          </svg>
          <div className="luno-eclipse__sweep" />
          {variant === "auth" && (
            <div className="luno-pixels">
              {PIXELS.map((pixel) => (
                <span
                  key={`${pixel.left}-${pixel.top}`}
                  className="luno-pixel"
                  style={
                    {
                      left: pixel.left,
                      top: pixel.top,
                      width: pixel.size,
                      height: pixel.size,
                      animationDuration: pixel.duration,
                      animationDelay: pixel.delay,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="luno-backdrop__grain" />
    </div>
  );
}
