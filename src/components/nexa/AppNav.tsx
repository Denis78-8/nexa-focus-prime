import { Fragment, useLayoutEffect, useRef, type ComponentType } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Transition,
} from "motion/react";
import { Check, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SPRING_SOFT } from "@/lib/motion";

/**
 * Workspace navigation. Presentation only: which section is shown and what
 * happens on selection stay with the caller (routes/index.tsx).
 *
 * - From 768px: a capsule in the header with a "liquid" orange indicator. Its
 *   two edges run on springs of different stiffness: the edge in the direction
 *   of travel leads, the other one catches up, so the pill stretches on the
 *   way and settles at the target.
 * - Below 768px: a bottom tab bar (primary sections) with a "Ещё" menu for the
 *   rest.
 */

export type NavItem<Id extends string> = {
  id: Id;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Unread counter shown on the item. */
  badge?: number;
  /** Called on hover/focus/touch, e.g. to prefetch the section's code. */
  onIntent?: () => void;
  /** Draw a thin divider before the item (e.g. before "Админ"). */
  separated?: boolean;
};

// Leading edge: quick and firm; trailing edge: softer, so the pill stretches.
const LEADING: Transition = { type: "spring", stiffness: 560, damping: 38, mass: 0.7 };
const TRAILING: Transition = { type: "spring", stiffness: 240, damping: 26, mass: 0.9 };

function badgeText(count: number) {
  return count > 99 ? "99+" : String(count);
}

function accessibleLabel(item: { label: string; badge?: number | undefined }) {
  return item.badge ? `${item.label}, непрочитанных: ${item.badge}` : item.label;
}

export function DesktopNav<Id extends string>({
  items,
  current,
  onSelect,
}: {
  items: NavItem<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const visible = useMotionValue(0);
  const width = useTransform(() => Math.max(0, right.get() - left.get()));
  const reduceMotion = useReducedMotion();
  const placed = useRef(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const place = (withMotion: boolean) => {
      const target = track.querySelector<HTMLElement>(`[data-nav-id="${current}"]`);
      if (!target || target.offsetWidth === 0) {
        visible.set(0);
        return;
      }
      const toLeft = target.offsetLeft;
      const toRight = toLeft + target.offsetWidth;
      visible.set(1);
      if (!withMotion || reduceMotion) {
        left.set(toLeft);
        right.set(toRight);
        return;
      }
      const movingRight = toLeft > left.get();
      animate(left, toLeft, movingRight ? TRAILING : LEADING);
      animate(right, toRight, movingRight ? LEADING : TRAILING);
    };
    // First placement (and the header mounting after the auth gate) jumps
    // straight to the active item; later changes of `current` glide.
    place(placed.current);
    placed.current = true;
    // Font loading and breakpoint changes resize the items: re-place without
    // motion. The observer's initial callback is skipped so it cannot cut the
    // glide that has just started.
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      place(false);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [current, reduceMotion, left, right, visible]);

  return (
    <nav aria-label="Разделы" className="hidden md:block">
      <div
        ref={trackRef}
        className="relative flex items-center gap-0.5 rounded-full border border-border bg-card/75 p-1 shadow-[inset_0_1px_0_oklch(1_0_0/0.04),0_8px_24px_-16px_oklch(0_0_0/0.8)]"
      >
        <motion.span
          aria-hidden
          className="luno-nav-indicator"
          style={{ x: left, width, opacity: visible }}
        />
        {items.map((item) => {
          const active = item.id === current;
          const Icon = item.icon;
          return (
            <Fragment key={item.id}>
              {item.separated && (
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border-strong" />
              )}
              <button
                type="button"
                data-nav-id={item.id}
                aria-current={active ? "page" : undefined}
                aria-label={accessibleLabel(item)}
                title={item.label}
                onClick={() => onSelect(item.id)}
                onPointerEnter={item.onIntent}
                onFocus={item.onIntent}
                className={`relative z-10 flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-[color,background-color,scale] duration-200 ease-(--ease-spring) active:scale-[0.95] lg:px-3 xl:px-3.5 xl:text-sm ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                }`}
              >
                <span className="relative lg:hidden">
                  <Icon className="h-[18px] w-[18px]" />
                  {item.badge ? (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                    />
                  ) : null}
                </span>
                <span className="hidden lg:inline">{item.label}</span>
                {item.badge ? (
                  <span
                    aria-hidden
                    className="hidden min-w-[1.125rem] rounded-full bg-primary px-1 text-center text-badge leading-[1.125rem] text-primary-foreground lg:inline-block"
                  >
                    {badgeText(item.badge)}
                  </span>
                ) : null}
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileTabBar<Id extends string>({
  primary,
  more,
  current,
  onSelect,
}: {
  primary: NavItem<Id>[];
  more: NavItem<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
}) {
  const moreActive = more.some((item) => item.id === current);
  const moreBadge = more.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const tabClass = (active: boolean) =>
    `relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-[color,scale] duration-200 ease-(--ease-spring) active:scale-[0.92] ${active ? "text-primary" : "text-muted-foreground"}`;
  const indicator = (
    <motion.span
      layoutId="luno-tabbar-indicator"
      transition={SPRING_SOFT}
      aria-hidden
      className="luno-tabbar-indicator"
    />
  );

  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5 px-1">
        {primary.map((item) => {
          const active = item.id === current;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={accessibleLabel(item)}
              onClick={() => onSelect(item.id)}
              onTouchStart={item.onIntent}
              onFocus={item.onIntent}
              className={tabClass(active)}
            >
              {active && indicator}
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" />
                {item.badge ? (
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
                  >
                    {badgeText(item.badge)}
                  </span>
                ) : null}
              </span>
              {item.label}
            </button>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={moreBadge ? `Ещё, непрочитанных: ${moreBadge}` : "Ещё"}
              className={tabClass(moreActive)}
            >
              {moreActive && indicator}
              <span className="relative">
                <MoreHorizontal className="h-[22px] w-[22px]" />
                {moreBadge ? (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                  />
                ) : null}
              </span>
              Ещё
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={10} className="w-60 p-1.5">
            {more.map((item) => {
              const Icon = item.icon;
              const active = item.id === current;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onSelect(item.id)}
                  className={`gap-3 rounded-lg px-2.5 py-2.5 text-[15px] ${active ? "text-primary" : ""}`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {item.label}
                  {item.badge ? (
                    <span className="ml-auto rounded-full bg-primary px-1.5 text-badge leading-[1.125rem] text-primary-foreground">
                      {badgeText(item.badge)}
                    </span>
                  ) : null}
                  {active && !item.badge && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
