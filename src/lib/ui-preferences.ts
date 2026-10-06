import { MotionGlobalConfig } from "motion/react";

// Per-device interface preferences. Stored only in this browser (no backend):
//  - animations: off skips every Motion animation, CSS transitions/animations
//    and the ambient background loop;
//  - density: compact tightens the global Tailwind spacing scale.
export type UiPreferences = { animations: boolean; compact: boolean };

const STORAGE_KEY = "luno-ui-preferences";
const DEFAULTS: UiPreferences = { animations: true, compact: false };
export const UI_PREFERENCES_EVENT = "luno:ui-preferences";

export function readUiPreferences(): UiPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<UiPreferences>) : {};
    return {
      animations: typeof parsed.animations === "boolean" ? parsed.animations : DEFAULTS.animations,
      compact: typeof parsed.compact === "boolean" ? parsed.compact : DEFAULTS.compact,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Applies preferences to the document and notifies listeners (e.g. the ambient background). */
export function applyUiPreferences(preferences: UiPreferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset["motion"] = preferences.animations ? "full" : "off";
  root.dataset["density"] = preferences.compact ? "compact" : "comfortable";
  MotionGlobalConfig.skipAnimations = !preferences.animations;
  window.dispatchEvent(new CustomEvent(UI_PREFERENCES_EVENT, { detail: preferences }));
}

export function saveUiPreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable (private mode); the preference still applies for this session.
  }
  applyUiPreferences(preferences);
}

/** True when the user switched interface animations off in Settings. */
export function animationsDisabledByUser() {
  return typeof document !== "undefined" && document.documentElement.dataset["motion"] === "off";
}
