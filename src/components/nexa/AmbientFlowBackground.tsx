import { useEffect, useRef, useSyncExternalStore } from "react";
import { LunoBackdrop } from "@/components/nexa/LunoBackdrop";

/**
 * Global ambient layer of the workspace: the LUNO eclipse backdrop (small and
 * dim, top-right; see LunoBackdrop and "LUNO backdrop" in styles.css). It is
 * pure CSS, so there is no draw loop: the browser composites the few animated
 * layers and pauses them in hidden tabs by itself.
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

/**
 * Dims the backdrop while a dialog is open or a form field has focus. Replaces
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
        <LunoBackdrop variant="app" />
      </div>
    </div>
  );
}
