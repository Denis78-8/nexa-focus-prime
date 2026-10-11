import { useId, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { SPRING_SOFT } from "@/lib/motion";

/**
 * Presentation-only pieces of the Tasks screen. Reduced motion and the
 * Settings switch apply app-wide (MotionConfig / MotionGlobalConfig).
 */

// The ring fills like a liquid: quick start, soft settle without overshoot.
const RING_FILL: Transition = { type: "spring", stiffness: 120, damping: 22, mass: 0.9 };
// A digit rolls like an odometer wheel.
const DIGIT_ROLL: Transition = { type: "spring", stiffness: 520, damping: 36, mass: 0.6 };

/**
 * Circular progress. `value` is 0–100, or null when there is nothing to show
 * (the track stays empty). Children are drawn in the centre.
 */
export function ProgressRing({
  value,
  size,
  stroke,
  tone = "primary",
  children,
  className = "",
}: {
  value: number | null;
  size: number;
  stroke: number;
  tone?: "primary" | "success" | "muted";
  children?: ReactNode;
  className?: string;
}) {
  const gradientId = useId();
  const radius = (size - stroke) / 2;
  const fraction = Math.max(0, Math.min(100, value ?? 0)) / 100;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF5A00" />
            <stop offset="100%" stopColor="#FFA21A" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border-strong"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={tone === "primary" ? `url(#${gradientId})` : "currentColor"}
          className={
            tone === "success"
              ? "text-success"
              : tone === "muted"
                ? "text-muted-foreground"
                : undefined
          }
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: fraction, opacity: fraction > 0 ? 1 : 0 }}
          transition={RING_FILL}
        />
      </svg>
      <span className="relative flex items-center justify-center">{children}</span>
    </span>
  );
}

/**
 * Elapsed time where each changed digit rolls in from below, like an odometer.
 * Only the digits that changed move; the separators stay put. Screen readers
 * get the plain value.
 */
export function RollingTime({ value, className = "" }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={`relative inline-flex tabular-nums ${className}`}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((char, index) =>
          /\d/.test(char) ? (
            // Keyed by position from the right, so 9:59:59 → 10:00:00 keeps
            // the seconds and minutes columns in place.
            <RollingDigit key={chars.length - index} digit={char} />
          ) : (
            <span key={`sep-${chars.length - index}`}>{char}</span>
          ),
        )}
      </span>
    </span>
  );
}

function RollingDigit({ digit }: { digit: string }) {
  return (
    <span className="relative inline-flex overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={digit}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={DIGIT_ROLL}
          className="inline-block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Two-option segmented control with a spring pill (Все / Мои, Комментарии / История). */
export function Segmented<Value extends string | boolean>({
  options,
  value,
  onChange,
  pillId,
  label,
  className = "",
}: {
  options: readonly (readonly [Value, ReactNode])[];
  value: Value;
  onChange: (value: Value) => void;
  /** layoutId of the pill; unique per control on screen. */
  pillId: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`relative inline-flex h-8 items-center rounded-full border border-border bg-background/60 p-0.5 ${className}`}
    >
      {options.map(([option, text]) => {
        const active = option === value;
        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`relative h-full whitespace-nowrap rounded-full px-3 text-callout font-medium transition-colors duration-200 ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                transition={SPRING_SOFT}
                className="absolute inset-0 rounded-full bg-secondary shadow-[inset_0_1px_0_oklch(1_0_0/0.06)]"
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
