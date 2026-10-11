import type { CSSProperties } from "react";
import type { Transition } from "motion/react";

// One motion vocabulary for LUNO DIGITAL (docs/LUNO_DIGITAL_VISUAL_AUDIT.md,
// section 9). CSS counterparts live in styles.css (--ease-out-soft,
// --ease-spring, luno-* keyframes). Reduced motion and the Settings switch are
// applied app-wide (MotionConfig in __root.tsx, MotionGlobalConfig in
// ui-preferences.ts), so these presets need no checks of their own.

export const EASE_OUT_SOFT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_SOFT = [0.4, 0, 1, 1] as const;

/** Hover, colour and small state changes. */
export const MICRO: Transition = { duration: 0.15, ease: EASE_OUT_SOFT };
/** Entering content: tab screens, expanding forms, panels. */
export const ENTER: Transition = { duration: 0.28, ease: EASE_OUT_SOFT };
/** Leaving content: always shorter than its entrance. */
export const EXIT: Transition = { duration: 0.16, ease: EASE_IN_SOFT };
/** Selection highlights, segmented pills and the navigation indicator (layoutId). */
export const SPRING_SOFT: Transition = { type: "spring", stiffness: 400, damping: 34, mass: 0.8 };
/** Presses and switches: settles with a slight overshoot. */
export const SPRING_SNAPPY: Transition = { type: "spring", stiffness: 520, damping: 28, mass: 0.7 };

/** Entrance delay for one .luno-rise element (staggered CSS entrance, styles.css). */
export const riseDelay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;
