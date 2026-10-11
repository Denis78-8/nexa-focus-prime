import { useEffect, useRef, useState, type ComponentType } from "react";
import { motion } from "motion/react";
import { Bell, ListChecks, Navigation, Palette, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BrandLogo } from "@/components/nexa/BrandLogo";
import { CURRENT_RELEASE, releaseDateLabel, type ReleaseChangeIcon } from "@/lib/release";
import { markWhatsNewSeen, shouldShowWhatsNew } from "@/lib/whats-new";
import { ENTER } from "@/lib/motion";

const CHANGE_ICON: Record<ReleaseChangeIcon, ComponentType<{ className?: string }>> = {
  style: Palette,
  navigation: Navigation,
  tasks: ListChecks,
  settings: SlidersHorizontal,
  notifications: Bell,
};

/** Pause after the workspace appears, so the window does not compete with the screen's own entrance. */
const OPEN_DELAY_MS = 700;

/**
 * "Что нового в LUNO DIGITAL": the release notes of the current version,
 * shown once per user and version in this browser. Rendered only inside the
 * signed-in workspace (after the session and access checks), never on the
 * sign-in screens. The mark is written only when the user dismisses the
 * window — "Всё понятно", ✕ or Escape; a click outside does not close it.
 */
export function WhatsNewDialog({ userId }: { userId: string }) {
  const release = CURRENT_RELEASE;
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!shouldShowWhatsNew(userId, release.version)) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, release.version]);

  const dismiss = () => {
    markWhatsNewSeen(userId, release.version);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
        className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-overlay p-0"
      >
        <header className="luno-profile-cover shrink-0 px-6 pb-6 pt-6 sm:px-7">
          <div className="relative">
            <BrandLogo variant="light" height={26} />
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-caption font-semibold text-primary">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_oklch(0.724_0.187_48.9/0.8)]"
                />
                Версия {release.version}
              </span>
              <span className="text-caption text-muted-foreground">
                <span className="sr-only">, выпуск от </span>
                <time dateTime={release.date}>{releaseDateLabel(release)}</time>
              </span>
            </div>
            <DialogTitle className="mt-3 text-title-1">{release.title}</DialogTitle>
            <DialogDescription className="mt-2 text-body text-foreground-secondary">
              {release.summary}
            </DialogDescription>
          </div>
        </header>

        <section
          aria-label={`Изменения в версии ${release.version}`}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7"
        >
          <ul className="space-y-4">
            {release.changes.map((change, index) => {
              const Icon = CHANGE_ICON[change.icon];
              return (
                <motion.li
                  key={change.title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...ENTER, delay: 0.18 + index * 0.05 }}
                  className="flex gap-3.5"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary-soft text-primary"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold text-foreground">{change.title}</h3>
                    <p className="mt-0.5 text-callout text-muted-foreground">{change.text}</p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </section>

        <footer className="flex shrink-0 justify-end border-t border-border px-6 py-4 sm:px-7">
          <Button
            ref={confirmRef}
            className="h-11 w-full rounded-full px-6 sm:w-auto"
            onClick={dismiss}
          >
            Всё понятно
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
