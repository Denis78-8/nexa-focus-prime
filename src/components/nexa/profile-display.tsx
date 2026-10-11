import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { ENTER, SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";

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

/** Text for a value the viewer may not see (privacy rules are unchanged). */
export const RESTRICTED_LABEL = "Недоступно по правам доступа";

/** profiles.access_level runs from 1 to 5. */
const MAX_ACCESS_LEVEL = 5;

function accessLevelLabel(level: number) {
  return `Уровень ${level}`;
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
  return (
    fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toLocaleUpperCase("ru-RU") || "NX"
  );
}

/**
 * The one way to render an employee's name. VIP names get the VIP champagne
 * colour (--vip) and a slightly heavier weight; everyone else keeps the
 * caller's style. Layout classes (truncate, size) come from the caller.
 */
export function EmployeeName({
  name,
  isVip,
  className = "",
  title,
}: {
  name: string;
  isVip?: boolean | null | undefined;
  className?: string;
  title?: string | undefined;
}) {
  return (
    <span title={title} className={`${className} ${isVip ? "font-semibold text-vip" : ""}`}>
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
      transition={ENTER}
      title="VIP"
      className={`inline-flex shrink-0 items-center rounded-full border border-vip/35 bg-vip/10 font-semibold uppercase tracking-[0.08em] text-vip ${size === "sm" ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[10px]"}`}
    >
      VIP
    </motion.span>
  );
}

/** The public "Директор" badge (get_visible_profile_badges / role). */
export function DirectorBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-border-strong bg-secondary font-medium text-foreground-secondary ${size === "sm" ? "px-1.5 py-px text-[10px]" : "px-2.5 py-0.5 text-caption"}`}
    >
      Директор
    </span>
  );
}

/** Small "это вы" marker next to the signed-in user's own name. */
export function SelfBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-primary-soft px-2 py-0.5 text-caption font-medium text-primary">
      Это вы
    </span>
  );
}

/**
 * Presence dot. Online pulses softly (hidden for reduced motion); `ring`
 * cuts it out of an avatar it sits on.
 */
export function PresenceDot({
  online,
  className = "",
  ring = "",
}: {
  online: boolean;
  className?: string;
  ring?: string;
}) {
  return (
    <span aria-hidden className={cn("relative flex shrink-0", className)}>
      {online && (
        <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-40 motion-reduce:hidden" />
      )}
      <span
        className={`relative h-full w-full rounded-full ${ring} ${online ? "bg-success" : "bg-muted-foreground/60"}`}
      />
    </span>
  );
}

/** "На связи" / "Не в сети" as a quiet pill. */
export function PresenceBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-callout ${online ? "border-success/25 bg-success/10 text-foreground" : "border-border bg-secondary/60 text-muted-foreground"}`}
    >
      <PresenceDot online={online} className="h-2 w-2" />
      {online ? ONLINE_LABEL : OFFLINE_LABEL}
    </span>
  );
}

/**
 * Access level as five rising bars, like signal strength; the filled ones
 * grow in one after another. Decorative: pair it with text or a label.
 */
export function AccessLevelMeter({ level, size = "md" }: { level: number; size?: "sm" | "md" }) {
  const small = size === "sm";
  return (
    <span
      aria-hidden
      className={`inline-flex items-end ${small ? "h-3 gap-[2px]" : "h-4 gap-[3px]"}`}
    >
      {Array.from({ length: MAX_ACCESS_LEVEL }, (_, index) => (
        <span
          key={index}
          className={`luno-level-bar rounded-full ${small ? "w-[3px]" : "w-1"} ${index < level ? "bg-primary" : "bg-border-strong"}`}
          style={{
            height: `${((index + 1) / MAX_ACCESS_LEVEL) * 100}%`,
            animationDelay: `${index * 70}ms`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Head of a profile: a cover with the LUNO eclipse rim, the photo cut into
 * it, name with badges, position, presence and optional actions. Phones get
 * a centred column (like Contacts), wider screens a row.
 */
export function ProfileHero({
  avatar,
  name,
  isVip,
  isDirector,
  isSelf = false,
  subtitle,
  presence,
  actions,
  heading: Heading = "h2",
}: {
  avatar: ReactNode;
  name: string;
  isVip: boolean | null | undefined;
  isDirector: boolean;
  isSelf?: boolean;
  subtitle: string;
  presence: ReactNode;
  actions?: ReactNode;
  heading?: "h1" | "h2";
}) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-card">
      <div aria-hidden className="luno-profile-cover h-24 sm:h-28" />
      <div className="flex flex-col items-center gap-4 px-5 pb-6 text-center sm:flex-row sm:items-start sm:gap-5 sm:px-6 sm:text-left">
        <div className="-mt-12 shrink-0 sm:-mt-14">{avatar}</div>
        <div className="min-w-0 flex-1 sm:pt-4">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 sm:justify-start">
            <Heading className="break-words text-title-1">
              <EmployeeName name={name} isVip={isVip} />
            </Heading>
            {isVip && <VipBadge />}
            {isDirector && <DirectorBadge />}
            {isSelf && <SelfBadge />}
          </div>
          <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>
          <div className="mt-3">{presence}</div>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:pt-4">{actions}</div>
        )}
      </div>
    </section>
  );
}

/** A round photo with the presence dot cut into its edge. */
export function HeroPhoto({ children, online }: { children: ReactNode; online: boolean }) {
  return (
    <div className="relative h-24 w-24 rounded-full bg-card ring-4 ring-card sm:h-28 sm:w-28">
      {children}
      <PresenceDot
        online={online}
        className="absolute bottom-1.5 right-1.5 h-4 w-4 sm:bottom-2 sm:right-2"
        ring="ring-4 ring-card"
      />
    </div>
  );
}

/** A titled group of rows, like an inset grouped list on iOS. */
export function InfoGroup({
  title,
  heading: Heading = "h2",
  children,
}: {
  title: string;
  heading?: "h2" | "h3";
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-card border border-border bg-card px-5 pb-1.5 pt-4">
      <Heading className="text-callout font-semibold text-foreground-secondary">{title}</Heading>
      <dl className="mt-1 divide-y divide-border">{children}</dl>
    </section>
  );
}

export function InfoRow({
  icon: Icon,
  label,
  value,
  muted = false,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  muted?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/70 text-foreground-secondary"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-caption text-muted-foreground">{label}</dt>
        <dd
          className={`mt-0.5 text-body [overflow-wrap:anywhere] ${muted ? "text-muted-foreground" : "text-foreground"}`}
        >
          {value}
        </dd>
      </div>
      {action}
    </div>
  );
}

/** Secondary facts as quiet tiles (access: level, role, status, VIP). */
export function FactTiles({
  title,
  heading: Heading = "h2",
  items,
}: {
  title: string;
  heading?: "h2" | "h3";
  items: { label: string; value: ReactNode; muted?: boolean }[];
}) {
  return (
    <section className="min-w-0 rounded-card border border-border bg-card p-4 sm:p-5">
      <Heading className="px-1 text-callout font-semibold text-foreground-secondary">
        {title}
      </Heading>
      <dl className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-0 rounded-xl border border-border bg-background/40 px-3 py-2.5"
          >
            <dt className="text-caption text-muted-foreground">{item.label}</dt>
            <dd
              className={`mt-1 break-words text-callout font-medium ${item.muted ? "font-normal text-muted-foreground" : "text-foreground"}`}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "Уровень 4" with the five-bar meter, or the restricted text. */
export function AccessLevelValue({ level }: { level: number | null }) {
  if (level === null) return <>{RESTRICTED_LABEL}</>;
  return (
    <span className="inline-flex items-center gap-2">
      {accessLevelLabel(level)}
      <AccessLevelMeter level={level} size="sm" />
    </span>
  );
}

/** Active / inactive with a coloured dot; null means the viewer may not see it. */
export function ActiveValue({ active }: { active: boolean | null }) {
  if (active === null) return <>{RESTRICTED_LABEL}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success" : "bg-destructive"}`} />
      {active ? "Активен" : "Неактивен"}
    </span>
  );
}

/** Round icon button that copies a visible value; the icon morphs into a check. */
export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Скопировано" : label}
      title={copied ? "Скопировано" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] duration-200 ease-(--ease-spring) active:scale-90 ${copied ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "done" : "copy"}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={SPRING_SNAPPY}
          className="flex"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
