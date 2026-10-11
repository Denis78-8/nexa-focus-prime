import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Compass, TriangleAlert } from "lucide-react";

import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/nexa/StatusScreen";
import { applyUiPreferences, readUiPreferences } from "@/lib/ui-preferences";
import appCss from "../styles.css?url";
import { AmbientFlowBackground } from "@/components/nexa/AmbientFlowBackground";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { useClearCacheOnUserChange } from "@/hooks/useClearCacheOnUserChange";

function NotFoundComponent() {
  return (
    <StatusScreen
      icon={Compass}
      title="Страница не найдена"
      actions={
        <Button asChild className="rounded-full px-5">
          <Link to="/">На главную</Link>
        </Button>
      }
    >
      Такой страницы нет или она переехала. Ошибка 404.
    </StatusScreen>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <StatusScreen
      icon={TriangleAlert}
      tone="warning"
      role="alert"
      title="Страница не загрузилась"
      actions={
        <>
          <Button
            className="rounded-full px-5"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Повторить
          </Button>
          <Button asChild variant="outline" className="rounded-full px-5">
            <a href="/">На главную</a>
          </Button>
        </>
      }
    >
      Что-то пошло не так на нашей стороне. Попробуйте ещё раз или вернитесь на главную.
    </StatusScreen>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LUNO DIGITAL" },
      { name: "description", content: "Рабочее пространство команды LUNO DIGITAL." },
      { name: "author", content: "LUNO DIGITAL" },
      { property: "og:title", content: "LUNO DIGITAL" },
      { property: "og:description", content: "Рабочее пространство команды LUNO DIGITAL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Sign-in screens draw their own opaque backdrop (AuthBackground).
const SIGN_IN_ROUTES = new Set(["/auth", "/change-password", "/owner-reset"]);

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Restore this browser's interface preferences (animations, density) on load.
  useEffect(() => {
    applyUiPreferences(readUiPreferences());
  }, []);
  useClearCacheOnUserChange(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Every Motion animation follows the system "reduce motion" setting;
          the Settings switch turns them off entirely (MotionGlobalConfig). */}
      <MotionConfig reducedMotion="user">
        {/* Sign-in screens have their own backdrop (AuthBackground); the
            workspace one is not mounted there at all. */}
        {!SIGN_IN_ROUTES.has(pathname) && <AmbientFlowBackground />}
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        {/* Single app-wide toaster; without it toast() calls were silent. */}
        <Toaster theme="dark" position="top-right" richColors closeButton />
      </MotionConfig>
    </QueryClientProvider>
  );
}
