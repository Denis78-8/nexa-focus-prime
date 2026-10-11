import type { ReactNode } from "react";
import { ListChecks, Timer, Users } from "lucide-react";
import { AuthBackground } from "@/components/nexa/AuthBackground";
import { BrandLogo } from "@/components/nexa/BrandLogo";
import { riseDelay } from "@/lib/motion";

/**
 * Shell of the sign-in screens (/auth, /change-password, /owner-reset):
 * from 1024px a brand stage on the left and the sign-in panel on the right,
 * with the eclipse rising from behind the panel's edge; on phones one column
 * with the logo inside the eclipse. Presentation only: the screens keep their
 * own forms and logic.
 */

const FEATURES = [
  {
    icon: ListChecks,
    title: "Задачи и проекты",
    text: "Подзадачи, исполнители, сроки и приоритеты",
  },
  { icon: Timer, title: "Учёт времени", text: "Таймер, интервалы и прогресс по каждой задаче" },
  { icon: Users, title: "Команда", text: "Сотрудники, роли и уровни доступа" },
] as const;

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="luno-auth dark relative min-h-dvh text-foreground">
      <AuthBackground />
      <div className="relative z-10 grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_var(--auth-panel-w)]">
        <section
          aria-label="LUNO DIGITAL"
          className="hidden min-h-dvh flex-col justify-between p-12 lg:flex xl:p-16"
        >
          <BrandLogo variant="light" height={44} className="luno-rise" />
          <div className="max-w-[25rem]">
            <p className="luno-rise text-display text-balance" style={riseDelay(90)}>
              Рабочее пространство команды
            </p>
            <p
              className="luno-rise mt-4 text-reading text-foreground-secondary"
              style={riseDelay(160)}
            >
              Задачи, время и люди LUNO DIGITAL — в одном месте.
            </p>
            <ul className="mt-10 space-y-5">
              {FEATURES.map(({ icon: Icon, title, text }, index) => (
                <li
                  key={title}
                  className="luno-rise flex items-start gap-4"
                  style={riseDelay(240 + index * 70)}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-card/80 text-primary">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{title}</span>
                    <span className="mt-0.5 block text-callout text-muted-foreground">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="luno-rise text-caption text-muted-foreground" style={riseDelay(460)}>
            © LUNO DIGITAL
          </p>
        </section>

        <main className="luno-panel-in relative flex min-h-dvh flex-col px-6 pb-8 sm:px-10 lg:border-l lg:border-border lg:bg-card/[0.88] lg:px-14 lg:py-10 lg:shadow-[-48px_0_96px_-48px_oklch(0_0_0/0.65)]">
          <div className="density-fixed mx-auto flex w-full max-w-[22.5rem] flex-1 flex-col lg:justify-center">
            {/* Below 1024px the logo sits inside the eclipse: this block is as tall
                as the rim's box (--auth-eclipse), centred on the eclipse. */}
            <div className="flex h-[calc(var(--auth-eclipse)*0.9)] shrink-0 items-center justify-center lg:hidden">
              <BrandLogo variant="light" height={46} />
            </div>
            {children}
          </div>
          <p className="density-fixed mt-10 text-center text-caption text-muted-foreground lg:hidden">
            © LUNO DIGITAL
          </p>
        </main>
      </div>
    </div>
  );
}
