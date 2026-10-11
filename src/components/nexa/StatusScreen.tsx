import type { ComponentType, ReactNode } from "react";
import { BrandLogo } from "@/components/nexa/BrandLogo";

const TONE = {
  neutral: "border-border bg-secondary/70 text-foreground-secondary",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

/**
 * Full-screen state of the app (not found, error, no connection, access
 * closed): the LUNO DIGITAL logo over a raised card with an icon, a title,
 * an explanation and actions. Presentation only.
 */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  children,
  actions,
  footer,
  role,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Extra content under the actions (left-aligned), e.g. DEV diagnostics. */
  footer?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="dark flex min-h-screen items-center justify-center px-4 py-16 text-foreground">
      <div
        role={role}
        className="luno-panel-in w-full max-w-md rounded-overlay border border-border bg-card/90 px-6 py-8 text-center shadow-raised backdrop-blur-xl sm:px-8"
      >
        <BrandLogo variant="light" height={30} className="mx-auto" />
        <span
          className={`mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full border ${TONE[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-title-2">{title}</h1>
        <div className="mt-2 text-body text-muted-foreground">{children}</div>
        {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
        {footer && <div className="mt-6 text-left">{footer}</div>}
      </div>
    </div>
  );
}
