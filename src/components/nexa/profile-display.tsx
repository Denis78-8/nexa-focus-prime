import type { ReactNode } from "react";
import { motion } from "motion/react";

// Shared presentation helpers for employee profile screens (Profile and the
// employee directory). Display only: nothing here reads or writes data.

export const ROLE_LABEL: Record<string, string> = {
  admin: "Администратор",
  director: "Директор",
  manager: "Менеджер",
  employee: "Сотрудник",
};

/** Live status labels (Realtime Presence, src/lib/presence.ts). */
export const ONLINE_LABEL = "На связи";
export const OFFLINE_LABEL = "Не в сети";

export function ProfileCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function ProfileField({ label, value, muted = false }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`break-words text-sm ${muted ? "text-muted-foreground" : ""}`}>{value}</dd>
    </div>
  );
}

// Demo placeholders that exist in profile data but must not be presented as
// real contact details. Display-only: stored values are not changed.
const DEMO_PLACEHOLDER_VALUES = new Set(["Воронеж"]);
export function realValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && !DEMO_PLACEHOLDER_VALUES.has(trimmed) ? trimmed : null;
}

/** A phone made of one repeated digit (e.g. 1111111111) is a test value. */
export function realPhone(value: string | null | undefined) {
  const phone = realValue(value);
  return phone && /^\+?(\d)\1{5,}$/.test(phone.replace(/[\s()-]/g, "")) ? null : phone;
}

export function initialsOf(fullName: string) {
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU") || "NX";
}

/**
 * The one way to render an employee's name. VIP names get the warm LUNO
 * accent and a slightly heavier weight; everyone else keeps the caller's style.
 * Layout classes (truncate, size) come from the caller.
 */
export function EmployeeName({ name, isVip, className = "", title }: { name: string; isVip?: boolean | null | undefined; className?: string; title?: string | undefined }) {
  return (
    <span title={title} className={`${className} ${isVip ? "font-semibold text-[oklch(0.83_0.13_68)]" : ""}`}>
      {name}
    </span>
  );
}

/** The one VIP mark used everywhere; render it only when profiles.is_vip is true. */
export function VipBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      title="VIP"
      className={`inline-flex shrink-0 items-center rounded border border-amber-300/35 bg-amber-300/[0.08] font-semibold uppercase tracking-[0.08em] text-amber-200/90 ${size === "sm" ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[10px]"}`}
    >
      VIP
    </motion.span>
  );
}
