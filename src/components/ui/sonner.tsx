import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts sit on the raised graphite surface. Rich colours keep their meaning
// (success / error / warning / info) but are tinted from the LUNO palette
// instead of sonner's own saturated greens and reds.
const LUNO_TOAST_COLORS = {
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border-strong)",
  "--normal-text": "var(--popover-foreground)",
  "--success-bg": "color-mix(in oklab, var(--success) 10%, var(--popover))",
  "--success-border": "color-mix(in oklab, var(--success) 28%, transparent)",
  "--success-text": "var(--foreground)",
  "--error-bg": "color-mix(in oklab, var(--destructive) 12%, var(--popover))",
  "--error-border": "color-mix(in oklab, var(--destructive) 32%, transparent)",
  "--error-text": "var(--foreground)",
  "--warning-bg": "color-mix(in oklab, var(--warning) 10%, var(--popover))",
  "--warning-border": "color-mix(in oklab, var(--warning) 28%, transparent)",
  "--warning-text": "var(--foreground)",
  "--info-bg": "var(--popover)",
  "--info-border": "var(--border-strong)",
  "--info-text": "var(--foreground)",
  "--border-radius": "calc(var(--radius) + 4px)",
} as CSSProperties;

const Toaster = ({ style, ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      style={{ ...LUNO_TOAST_COLORS, ...style }}
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:shadow-raised",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-destructive",
          warning: "[&_[data-icon]]:text-warning",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
