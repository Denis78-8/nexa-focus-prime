import { createFileRoute, Navigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AtSign,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  Mail,
  LogOut,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TaskWorkspace } from "@/components/nexa/TaskWorkspace";
import { AdminPanel } from "@/components/nexa/AdminPanel";
import { getAdminAccess } from "@/lib/admin.functions";
import { getMyCorporateMailbox } from "@/lib/admin.functions";
import { getAuthGateDiagnostics, getCurrentProfile } from "@/lib/profile.functions";
import { getMyCredentialState, TEMPORARY_PASSWORD_EXPIRED_MESSAGE } from "@/lib/credentials.functions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  cancelAccessLevelRequest,
  createAccessLevelRequest,
  getMyAccessLevelRequests,
  reviewAccessLevelRequest,
  type AccessRequestItem,
} from "@/lib/access-requests.functions";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEXA Helpdesk — Obsidian Flow" },
      {
        name: "description",
        content:
          "Интерактивный прототип интерфейса NEXA Helpdesk в строгом graphite/orange стиле: обзор, заявки, клиенты, база знаний и настройки.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "NEXA Helpdesk — Obsidian Flow" },
      {
        property: "og:description",
        content:
          "Прототип NEXA Helpdesk: графитовый фон, тёплый оранжевый акцент, живая верхняя навигация.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NexaPrototype,
});

type ScreenId = "overview" | "tickets" | "clients" | "knowledge" | "settings" | "profile" | "notifications";

type EmployeeProfileData = {
  initials: string;
  id: string;
  full_name: string;
  position: string | null;
  department: string | null;
  avatar_url: string | null;
  presence: string;
  created_at: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  access_level: number | null;
  is_active: boolean;
  is_vip: boolean | null;
  role: string | null;
  is_director: boolean | null;
  private_fields_allowed: boolean;
  access_flags_error: string | null;
};

type AuthGateDiagnosticsState = {
  stage: string;
  sessionUserId: string;
  sessionEmail: string | null;
  ensureOutcome: string;
  profileLoaded: boolean | null;
  accessFlagsLoaded: boolean | null;
  profileUserId: string | null;
  profileIsActive: boolean | null;
  profileAccessLevel: number | null;
  profileIsVip: boolean | null;
  role: string | null;
  ownerCheck: string | null;
  adminAccessCheck: string | null;
  errorText: string | null;
};

function safeDiagnosticError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Неизвестная ошибка";
  return raw
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [скрыто]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[скрытый токен]")
    .slice(0, 500);
}

function getInitials(fullName: string) {
  return fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU") || "NX";
}

async function signOutCurrentUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "tickets", label: "Заявки" },
  { id: "clients", label: "Клиенты" },
  { id: "knowledge", label: "База знаний" },
  { id: "notifications", label: "Уведомления" },
  { id: "settings", label: "Настройки" },
  { id: "profile", label: "Профиль" },
];

const TICKETS = [
  { id: "NX-1042", title: "Не синхронизируется почтовый ящик", client: "ООО «Вектор»", priority: "Высокий", status: "В работе", agent: "А. Соколова", age: "12 мин" },
  { id: "NX-1041", title: "Ошибка 500 при экспорте отчёта", client: "АО «Меридиан»", priority: "Критический", status: "Новая", agent: "—", age: "26 мин" },
  { id: "NX-1038", title: "Добавить роль наблюдателя", client: "ИП Ким", priority: "Средний", status: "Ожидает", agent: "Д. Орлов", age: "1 ч" },
  { id: "NX-1035", title: "Сброс двухфакторной аутентификации", client: "ООО «Север»", priority: "Низкий", status: "Решена", agent: "М. Литвин", age: "3 ч" },
  { id: "NX-1031", title: "Медленная загрузка портала", client: "АО «Меридиан»", priority: "Высокий", status: "В работе", agent: "А. Соколова", age: "5 ч" },
];

const CLIENTS = [
  { name: "АО «Меридиан»", plan: "Enterprise", open: 6, sla: "99.9%" },
  { name: "ООО «Вектор»", plan: "Business", open: 3, sla: "99.5%" },
  { name: "ООО «Север»", plan: "Business", open: 1, sla: "99.8%" },
  { name: "ИП Ким", plan: "Starter", open: 2, sla: "98.9%" },
];

const ARTICLES = [
  { title: "Подключение почтового канала", views: 1284, updated: "2 дня назад" },
  { title: "Настройка SLA-политик", views: 961, updated: "5 дней назад" },
  { title: "Роли и права доступа", views: 847, updated: "1 неделю назад" },
  { title: "Экспорт отчётов в CSV", views: 402, updated: "2 недели назад" },
];

function statusClass(status: string) {
  switch (status) {
    case "Новая":
      return "bg-primary/15 text-primary";
    case "В работе":
      return "bg-secondary text-secondary-foreground";
    case "Ожидает":
      return "bg-secondary text-muted-foreground";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function priorityClass(p: string) {
  if (p === "Критический") return "text-destructive";
  if (p === "Высокий") return "text-primary";
  return "text-muted-foreground";
}

function NexaPrototype() {
  const [active, setActive] = useState<ScreenId>("overview");
  const [adminOpen, setAdminOpen] = useState(false);
  const [newRequestStep, setNewRequestStep] = useState<"closed" | "choose" | "access">("closed");
  const [accessRequestsVersion, setAccessRequestsVersion] = useState(0);
  const [canOpenAdmin, setCanOpenAdmin] = useState(false);
  const [workspaceAccessSession, setWorkspaceAccessSession] = useState<Session | null>(null);
  const [blockedSession, setBlockedSession] = useState<Session | null>(null);
  const [currentProfile, setCurrentProfile] = useState<EmployeeProfileData | null>(null);
  const [authGateDiagnostics, setAuthGateDiagnostics] = useState<AuthGateDiagnosticsState | null>(null);
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
  const [credentialGate, setCredentialGate] = useState<"change" | "expired" | null>(null);
  const loadCredentialState = useServerFn(getMyCredentialState);
  const checkAdmin = useServerFn(getAdminAccess);
  const loadCurrentProfile = useServerFn(getCurrentProfile);
  const loadAuthGateDiagnostics = useServerFn(getAuthGateDiagnostics);
  const { session, loading, connectionError } = useAuth();
  const navRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    let live = true;
    setCanOpenAdmin(false);
    if (session) {
      let stage = "getCurrentProfile (profiles + is_active_user + optional access flags)";
      const updateDiagnostics = (patch: Partial<AuthGateDiagnosticsState>) => {
        setAuthGateDiagnostics((current) => current ? { ...current, ...patch } : current);
      };
      setAuthGateDiagnostics({
        stage,
        sessionUserId: session.user.id,
        sessionEmail: session.user.email ?? null,
        ensureOutcome: "Не вызывается Auth Gate",
        profileLoaded: null,
        accessFlagsLoaded: null,
        profileUserId: null,
        profileIsActive: null,
        profileAccessLevel: null,
        profileIsVip: null,
        role: null,
        ownerCheck: null,
        adminAccessCheck: null,
        errorText: null,
      });
      if (import.meta.env.DEV) {
        console.info("[NEXA Auth Gate DEV] session", {
          userId: session.user.id,
          email: session.user.email ?? null,
        });
      }
      void (async () => {
        try {
          // A pending mandatory password change keeps the workspace closed.
          // The database enforces the same rule through is_active_user().
          stage = "get_my_credential_state";
          updateDiagnostics({ stage });
          const credentials = await loadCredentialState();
          if (!live) return;
          if (credentials.mustChangePassword) {
            setCredentialGate(credentials.expired ? "expired" : "change");
            setCurrentProfile(null);
            setBlockedSession(null);
            setWorkspaceAccessSession(session);
            return;
          }
          setCredentialGate(null);
          stage = "getCurrentProfile (profiles + is_active_user + optional access flags)";
          updateDiagnostics({ stage });
          const profile = await loadCurrentProfile();
          if (!live) return;
          updateDiagnostics({
            profileLoaded: true,
            profileUserId: profile.id,
            profileIsActive: profile.is_active,
            profileAccessLevel: profile.access_level,
            profileIsVip: profile.is_vip,
            role: profile.role,
          });
          if (import.meta.env.DEV) {
            console.info("[NEXA Auth Gate DEV] profile loaded", {
              profileLoaded: Boolean(profile.id),
              profileIdMatchesSession: profile.id === session.user.id,
              isActive: profile.is_active,
              accessLevel: profile.access_level,
              isVip: profile.is_vip,
              role: profile.role,
            });
          }
          if (profile.id !== session.user.id) throw new Error("Профиль не соответствует текущей сессии");
          setCurrentProfile({ ...profile, initials: getInitials(profile.full_name) });
          setWorkspaceAccessSession(session);
          setBlockedSession(null);
          stage = "Auth Gate diagnostic checks";
          updateDiagnostics({ stage });
          if (import.meta.env.DEV) {
            try {
              const diagnostic = await loadAuthGateDiagnostics();
              updateDiagnostics({
                profileUserId: diagnostic.profileUserId,
                accessFlagsLoaded: diagnostic.flagsLoaded,
                profileIsActive: diagnostic.isActive,
                profileAccessLevel: diagnostic.accessLevel,
                profileIsVip: diagnostic.isVip,
                role: diagnostic.role,
                ownerCheck: diagnostic.ownerCheck,
                adminAccessCheck: diagnostic.adminAccess === null
                  ? diagnostic.permissionError ? `ошибка: ${safeDiagnosticError(diagnostic.permissionError.message)}` : null
                  : String(diagnostic.adminAccess),
                errorText: [diagnostic.profileError?.message, diagnostic.activeError?.message, diagnostic.flagsError?.message]
                  .filter(Boolean).map((message) => safeDiagnosticError(message!)).join("; ") || null,
              });
              if (live) console.info("[NEXA Auth Gate DEV] access checks", diagnostic);
            } catch (error) {
              console.error("[NEXA Auth Gate DEV] diagnostics failed", {
                message: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }
          stage = "has_permission(admin.access)";
          updateDiagnostics({ stage });
          void checkAdmin()
            .then((result) => {
              updateDiagnostics({ adminAccessCheck: String(result.allowed) });
              if (import.meta.env.DEV) console.info("[NEXA Auth Gate DEV] Admin Panel permission", { allowed: result.allowed });
              if (live) setCanOpenAdmin(result.allowed);
            })
            .catch((error: unknown) => {
              updateDiagnostics({ errorText: safeDiagnosticError(error), adminAccessCheck: "ошибка: проверка не прошла" });
              if (import.meta.env.DEV) console.error("[NEXA Auth Gate DEV] admin permission check failed", {
                message: error instanceof Error ? error.message : "Unknown error",
              });
              if (live) setCanOpenAdmin(false);
            });
        } catch (error) {
          if (!live) return;
          updateDiagnostics({
            stage,
            ...(stage.startsWith("getCurrentProfile") ? { profileLoaded: false } : {}),
            errorText: safeDiagnosticError(error),
          });
          if (import.meta.env.DEV) {
            console.error("[NEXA Auth Gate DEV] access denied", {
              stage,
              userId: session.user.id,
              email: session.user.email ?? null,
              message: error instanceof Error ? error.message : "Unknown error",
            });
            try {
              const diagnostic = await loadAuthGateDiagnostics();
              updateDiagnostics({
                profileUserId: diagnostic.profileUserId,
                accessFlagsLoaded: diagnostic.flagsLoaded,
                profileIsActive: diagnostic.isActive,
                profileAccessLevel: diagnostic.accessLevel,
                profileIsVip: diagnostic.isVip,
                role: diagnostic.role,
                ownerCheck: diagnostic.ownerCheck,
                adminAccessCheck: diagnostic.adminAccess === null
                  ? diagnostic.permissionError ? `ошибка: ${safeDiagnosticError(diagnostic.permissionError.message)}` : null
                  : String(diagnostic.adminAccess),
                errorText: safeDiagnosticError(error),
              });
              console.info("[NEXA Auth Gate DEV] diagnostic snapshot after failure", diagnostic);
            } catch (diagnosticError) {
              console.error("[NEXA Auth Gate DEV] diagnostic snapshot failed", {
                message: diagnosticError instanceof Error ? diagnosticError.message : "Unknown error",
              });
            }
          }
          setCurrentProfile(null);
          setWorkspaceAccessSession(session);
          setBlockedSession(session);
        }
      })();
    }
    return () => { live = false; };
  }, [session, loadCurrentProfile, loadAuthGateDiagnostics, loadCredentialState, checkAdmin, authCheckAttempt]);

  useEffect(() => {
    if (active !== "profile" || !session || blockedSession) return;
    let live = true;
    void loadCurrentProfile()
      .then((profile) => {
        if (!live) return;
        if (profile.id !== session.user.id) throw new Error("Профиль не соответствует текущей сессии");
        setCurrentProfile({ ...profile, initials: getInitials(profile.full_name) });
      })
      .catch((error: unknown) => {
        if (live) toast.error(`Не удалось обновить профиль из Cloud: ${safeDiagnosticError(error)}`);
      });
    return () => { live = false; };
  }, [active, session, blockedSession, loadCurrentProfile]);

  const refreshProfileAfterEmployeeSave = async (userId: string) => {
    if (!session || userId !== session.user.id) return;
    const profile = await loadCurrentProfile();
    if (profile.id !== session.user.id) throw new Error("Профиль не соответствует текущей сессии");
    setCurrentProfile({ ...profile, initials: getInitials(profile.full_name) });
  };

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const updateIndicator = () => {
      const btn = nav.querySelector<HTMLButtonElement>(`[data-screen="${active}"]`);
      if (!btn) return;
      const navRect = nav.getBoundingClientRect();
      const buttonRect = btn.getBoundingClientRect();
      setIndicator({ left: buttonRect.left - navRect.left, width: buttonRect.width });
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active]);

  if (loading || session && workspaceAccessSession !== session) {
    return (
      <div className="dark flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Проверяем сессию…
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div role="alert" className="max-w-md border-t border-primary pt-5">
          <h1 className="text-lg font-semibold">NEXA временно недоступен</h1>
          <p className="mt-2 text-sm text-muted-foreground">Не удалось подключиться к рабочему пространству. Повторите попытку позже.</p>
          <Button variant="outline" className="mt-5 border-border bg-card hover:bg-secondary hover:text-foreground" onClick={() => window.location.reload()}>Повторить</Button>
        </div>
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" />;
  if (credentialGate === "change") return <Navigate to="/change-password" />;
  if (credentialGate === "expired") {
    return (
      <div className="dark flex min-h-screen items-center justify-center px-6 text-foreground">
        <div role="alert" className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="font-semibold">Доступ к NEXA закрыт</h1>
          <p className="mt-2 text-sm text-muted-foreground">{TEMPORARY_PASSWORD_EXPIRED_MESSAGE}</p>
          <Button variant="outline" className="mt-4" onClick={() => void signOutCurrentUser().catch((error: Error) => toast.error(error.message))}>
            <LogOut />
            Выйти
          </Button>
        </div>
      </div>
    );
  }
  if (blockedSession === session) {
    return (
      <div className="dark flex min-h-screen items-center justify-center px-6 text-foreground">
        <div role="alert" className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="font-semibold">Доступ к NEXA закрыт</h1>
          {authGateDiagnostics?.stage === "get_my_credential_state" ? (
            // A failed credential-state check is a server/schema problem, not a
            // disabled account; show the real error instead of a generic denial.
            <p className="mt-2 text-sm text-muted-foreground">
              Не удалось проверить состояние учётных данных: {authGateDiagnostics.errorText ?? "неизвестная ошибка"}. Обратитесь к владельцу NEXA.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Учётная запись отключена или не удалось подтвердить доступ. Обратитесь к администратору.</p>
          )}
          {import.meta.env.DEV && authGateDiagnostics && (
            <section aria-label="Диагностика Auth Gate" className="mt-4 rounded-md border border-border bg-background/60 p-3 text-left text-xs">
              <h2 className="mb-2 font-semibold">Диагностика</h2>
              <dl className="grid grid-cols-[minmax(130px,auto)_1fr] gap-x-3 gap-y-1 break-all">
                <dt>stage</dt><dd>{authGateDiagnostics.stage}</dd>
                <dt>session user id</dt><dd>{authGateDiagnostics.sessionUserId}</dd>
                <dt>session email</dt><dd>{authGateDiagnostics.sessionEmail ?? "—"}</dd>
                <dt>ensure_my_profile()</dt><dd>{authGateDiagnostics.ensureOutcome}</dd>
                <dt>profile loaded</dt><dd>{authGateDiagnostics.profileLoaded === null ? "неизвестно" : authGateDiagnostics.profileLoaded ? "да" : "нет"}</dd>
                <dt>access flags loaded</dt><dd>{authGateDiagnostics.accessFlagsLoaded === null ? "неизвестно" : authGateDiagnostics.accessFlagsLoaded ? "да" : "нет"}</dd>
                <dt>profile user id</dt><dd>{authGateDiagnostics.profileUserId ?? "—"}</dd>
                {authGateDiagnostics.profileUserId && authGateDiagnostics.profileUserId !== authGateDiagnostics.sessionUserId && (
                  <><dt>UUID mismatch</dt><dd>session: {authGateDiagnostics.sessionUserId}; profile: {authGateDiagnostics.profileUserId}</dd></>
                )}
                <dt>profile is_active</dt><dd>{authGateDiagnostics.profileIsActive === null ? "неизвестно" : String(authGateDiagnostics.profileIsActive)}</dd>
                <dt>profile access_level</dt><dd>{authGateDiagnostics.profileAccessLevel ?? "—"}</dd>
                <dt>profile is_vip</dt><dd>{authGateDiagnostics.profileIsVip === null ? "неизвестно" : String(authGateDiagnostics.profileIsVip)}</dd>
                <dt>role</dt><dd>{authGateDiagnostics.role ?? "—"}</dd>
                <dt>owner check</dt><dd>{authGateDiagnostics.ownerCheck ?? "неизвестно"}</dd>
                <dt>admin.access check</dt><dd>{authGateDiagnostics.adminAccessCheck ?? "неизвестно"}</dd>
                <dt>ошибка</dt><dd>{authGateDiagnostics.errorText ?? "нет"}</dd>
              </dl>
            </section>
          )}
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setBlockedSession(null);
              setWorkspaceAccessSession(null);
              setCurrentProfile(null);
              setAuthCheckAttempt((attempt) => attempt + 1);
            }}
          >
            Повторить проверку
          </Button>
          <Button variant="outline" className="mt-4" onClick={() => void signOutCurrentUser().catch((error: Error) => toast.error(error.message))}>
            <LogOut />
            Выйти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3 xl:gap-8">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              N
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">NEXA</div>
              <div className="text-[11px] text-muted-foreground">Helpdesk · Obsidian Flow</div>
            </div>
          </div>

          {/* Nav with sliding indicator */}
          <nav ref={navRef} className="relative flex min-w-0 items-center gap-0.5 overflow-x-auto xl:gap-1">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                data-screen={s.id}
                 type="button"
                onClick={() => setActive(s.id)}
                 aria-current={active === s.id ? "page" : undefined}
                className={`relative z-10 shrink-0 rounded-md px-2.5 py-2 text-sm transition-colors duration-200 active:scale-[0.97] xl:px-3.5 ${
                  active === s.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
            <span
              aria-hidden
              className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          </nav>

           <div className="ml-auto flex shrink-0 items-center gap-3">
            {canOpenAdmin && <button type="button" onClick={() => setAdminOpen((open) => !open)} className={`rounded-md border px-3 py-1.5 text-sm ${adminOpen ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Администрирование</button>}
            <button className="hidden rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground lg:block">
              Поиск
            </button>
            <button type="button" onClick={() => setNewRequestStep("choose")} className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              + Заявка
            </button>
            <button
              type="button"
              aria-label="Открыть профиль сотрудника"
              onClick={() => setActive("profile")}
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold transition-all duration-200 hover:bg-primary hover:text-primary-foreground active:scale-95"
            >
              {currentProfile?.initials ?? "NX"}
              {currentProfile?.is_vip && <span title="VIP" aria-label="VIP" className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-amber-300/40 bg-amber-400/15 text-[9px] text-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.22)]">✦</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {currentProfile?.access_flags_error && (
          <p role="status" className="mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {safeDiagnosticError(currentProfile.access_flags_error)} Основной доступ открыт по активной сессии и профилю; дополнительные access flags будут доступны после синхронизации RPC в Cloud.
          </p>
        )}
        {adminOpen ? <AdminPanel onEmployeeSaved={refreshProfileAfterEmployeeSave} /> : active === "overview" && <Overview go={setActive} />}
        {!adminOpen && active === "tickets" && <Tickets />}
        {!adminOpen && active === "clients" && <Clients />}
        {!adminOpen && active === "knowledge" && <Knowledge />}
        {!adminOpen && active === "notifications" && currentProfile && <AccessNotifications key={accessRequestsVersion} profile={currentProfile} />}
        {!adminOpen && active === "settings" && <Settings />}
        {!adminOpen && active === "profile" && currentProfile && <EmployeeProfile employee={currentProfile} />}
      </main>

      <Dialog open={newRequestStep !== "closed"} onOpenChange={(open) => { if (!open) setNewRequestStep("closed"); }}>
        <DialogContent className="dark border-border bg-card text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{newRequestStep === "access" ? "Предоставление доступа" : "Новая заявка"}</DialogTitle>
            <DialogDescription>
              {newRequestStep === "access" ? "Запрос получит владелец NEXA. Уровень изменится только после его одобрения." : "Выберите тип заявки"}
            </DialogDescription>
          </DialogHeader>
          {newRequestStep === "choose" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { setNewRequestStep("closed"); setAdminOpen(false); setActive("tickets"); }}
                className="rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="text-sm font-medium">Задача</div>
                <div className="mt-1 text-xs text-muted-foreground">Создать задачу в проекте</div>
              </button>
              <button
                type="button"
                onClick={() => setNewRequestStep("access")}
                className="rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="text-sm font-medium">Предоставление доступа</div>
                <div className="mt-1 text-xs text-muted-foreground">Запросить более высокий уровень доступа</div>
              </button>
            </div>
          )}
          {newRequestStep === "access" && currentProfile && (
            <AccessRequestForm
              currentLevel={currentProfile.access_level}
              onSubmitted={() => {
                setNewRequestStep("closed");
                setAccessRequestsVersion((version) => version + 1);
              }}
              onCancel={() => setNewRequestStep("choose")}
            />
          )}
        </DialogContent>
      </Dialog>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-muted-foreground">
          <span>NEXA Helpdesk — визуальный прототип</span>
          <span>Obsidian Flow · v0.2</span>
        </div>
      </footer>
    </div>
  );
}

const ACCESS_STATUS_LABEL: Record<AccessRequestItem["status"], string> = {
  pending: "Ожидает решения владельца",
  approved: "Одобрена",
  rejected: "Отклонена",
  cancelled: "Отменена",
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function AccessRequestForm({ currentLevel, onSubmitted, onCancel }: { currentLevel: number | null; onSubmitted: () => void; onCancel?: () => void }) {
  const submitRequest = useServerFn(createAccessLevelRequest);
  const level = currentLevel ?? 1;
  const levels = Array.from({ length: Math.max(0, 5 - level) }, (_, index) => level + index + 1);
  const [requestedLevel, setRequestedLevel] = useState(String(Math.min(5, level + 1)));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (levels.length === 0) {
    return <p className="text-sm text-muted-foreground">У вас уже максимальный уровень доступа.</p>;
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await submitRequest({ data: { requestedLevel: Number(requestedLevel), reason } });
      setReason("");
      toast.success("Заявка отправлена владельцу NEXA");
      onSubmitted();
    } catch (error) {
      toast.error(safeDiagnosticError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted-foreground">Текущий уровень: {currentLevel ?? "не определён"}. Уровень изменится только после решения владельца.</p>
      <label className="block text-xs text-muted-foreground">
        Запрошенный уровень
        <select value={requestedLevel} onChange={(event) => setRequestedLevel(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground">
          {levels.map((option) => <option key={option} value={option}>Уровень {option}</option>)}
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">
        Причина
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={2000} required rows={3} className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder="Опишите, зачем нужен новый уровень" />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Назад</Button>}
        <Button type="submit" disabled={saving}>{saving ? "Отправка…" : "Отправить владельцу"}</Button>
      </div>
    </form>
  );
}

function AccessNotifications({ profile }: { profile: EmployeeProfileData }) {
  const loadRequests = useServerFn(getMyAccessLevelRequests);
  const resolveRequest = useServerFn(reviewAccessLevelRequest);
  const withdrawRequest = useServerFn(cancelAccessLevelRequest);
  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setRequests(await loadRequests());
    } catch (error) {
      toast.error(`Не удалось загрузить уведомления: ${safeDiagnosticError(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [loadRequests]);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setSaving(true);
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error(safeDiagnosticError(error));
    } finally {
      setSaving(false);
      await refresh();
    }
  };

  const review = (requestId: string, decision: "approved" | "rejected") =>
    runAction(() => resolveRequest({ data: { requestId, decision } }), decision === "approved" ? "Доступ предоставлен" : "Заявка отклонена");
  const cancel = (requestId: string) =>
    runAction(() => withdrawRequest({ data: { requestId } }), "Заявка отменена");

  const hasPendingOwnRequest = requests.some((request) => request.can_cancel);

  return (
    <div className="animate-fade-in">
      <SectionTitle title="Уведомления" sub="Заявки на повышение уровня доступа рассматривает только владелец NEXA" />
      {(profile.access_level ?? 1) < 5 && !loading && !hasPendingOwnRequest && (
        <section className="mb-6 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-medium">Запросить уровень доступа</h2>
          <AccessRequestForm currentLevel={profile.access_level} onSubmitted={() => void refresh()} />
        </section>
      )}

      <div className="space-y-3">
        {loading && <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Загрузка уведомлений…</p>}
        {!loading && requests.length === 0 && <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Уведомлений и заявок пока нет.</p>}
        {requests.map((request) => (
          <article key={request.id} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{request.notification_title ?? "Заявка на предоставление доступа"}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{request.employee_name} · текущий уровень {request.current_level} · запрошен уровень {request.requested_level}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${request.status === "pending" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>{ACCESS_STATUS_LABEL[request.status]}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{request.reason}</p>
            <p className="mt-3 text-xs text-muted-foreground">Создана: {formatDateTime(request.created_at)}</p>
            {request.reviewed_at && <p className="mt-1 text-xs text-muted-foreground">Решение принял владелец NEXA{request.reviewer_name ? ` · ${request.reviewer_name}` : ""} · {formatDateTime(request.reviewed_at)}</p>}
            {request.cancelled_at && <p className="mt-1 text-xs text-muted-foreground">Отменена сотрудником · {formatDateTime(request.cancelled_at)}</p>}
            {request.is_owner_review && request.status === "pending" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" disabled={saving} onClick={() => void review(request.id, "approved")}>{saving ? "Сохранение…" : "Одобрить"}</Button>
                <Button type="button" variant="outline" disabled={saving} onClick={() => void review(request.id, "rejected")}>Отклонить</Button>
                <span className="self-center text-xs text-primary">{request.action_label ?? "Рассмотреть"}</span>
              </div>
            )}
            {request.can_cancel && !request.is_owner_review && (
              <div className="mt-4">
                <Button type="button" variant="outline" disabled={saving} onClick={() => void cancel(request.id)}>Отменить заявку</Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="sr-only" aria-hidden="true"><Bell /></div>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

function Overview({ go }: { go: (s: ScreenId) => void }) {
  const stats = [
    { label: "Открытые заявки", value: "24", delta: "+3 за сутки" },
    { label: "Среднее время ответа", value: "7 мин", delta: "−12% к неделе" },
    { label: "SLA соблюдение", value: "99.4%", delta: "стабильно" },
    { label: "CSAT", value: "4.8", delta: "+0.2" },
  ];
  return (
    <div>
      <SectionTitle title="Обзор" sub="Ключевые метрики службы поддержки за сегодня" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold">{s.value}</div>
            <div className="mt-1 text-xs text-primary">{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Последние заявки</h2>
            <button onClick={() => go("tickets")} className="text-xs text-primary hover:underline">
              Все заявки →
            </button>
          </div>
          <div className="divide-y divide-border">
            {TICKETS.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-20 font-mono text-xs text-muted-foreground">{t.id}</span>
                <span className="flex-1 truncate">{t.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(t.status)}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Нагрузка команды</h2>
          {[
            { name: "А. Соколова", load: 82 },
            { name: "Д. Орлов", load: 64 },
            { name: "М. Литвин", load: 41 },
          ].map((a) => (
            <div key={a.name} className="mb-3">
              <div className="mb-1 flex justify-between text-xs">
                <span>{a.name}</span>
                <span className="text-muted-foreground">{a.load}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${a.load}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tickets() {
  return (
    <div className="animate-fade-in">
      <TaskWorkspace />
    </div>
  );
}

function Clients() {
  return (
    <div>
      <SectionTitle title="Клиенты" sub="Аккаунты, тарифы и открытые обращения" />
      <div className="grid gap-4 sm:grid-cols-2">
        {CLIENTS.map((c) => (
          <div key={c.name} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{c.name}</h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{c.plan}</span>
            </div>
            <div className="mt-4 flex gap-6 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Открытые заявки</div>
                <div className="mt-0.5 text-lg font-semibold text-primary">{c.open}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SLA</div>
                <div className="mt-0.5 text-lg font-semibold">{c.sla}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Knowledge() {
  return (
    <div>
      <SectionTitle title="База знаний" sub="Статьи для клиентов и агентов" />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {ARTICLES.map((a) => (
          <div key={a.title} className="flex items-center gap-4 px-5 py-4 hover:bg-secondary/50">
            <div className="flex-1">
              <div className="text-sm font-medium">{a.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Обновлено: {a.updated}</div>
            </div>
            <div className="text-xs text-muted-foreground">{a.views} просмотров</div>
            <button className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
              Открыть
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const [email, setEmail] = useState(true);
  const [slack, setSlack] = useState(false);
  const [auto, setAuto] = useState(true);
  const rows = [
    { label: "Email-уведомления", desc: "Отправлять клиентам статусы заявок", value: email, set: setEmail },
    { label: "Slack-интеграция", desc: "Дублировать критические заявки в канал", value: slack, set: setSlack },
    { label: "Автоназначение", desc: "Распределять новые заявки по нагрузке", value: auto, set: setAuto },
  ];
  return (
    <div>
      <SectionTitle title="Настройки" sub="Каналы и автоматизация рабочего пространства" />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-sm font-medium">{r.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{r.desc}</div>
            </div>
            <button
              onClick={() => r.set(!r.value)}
              aria-pressed={r.value}
              className={`relative h-6 w-11 rounded-full transition-colors ${r.value ? "bg-primary" : "bg-secondary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-all ${
                  r.value ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeProfile({ employee }: { employee: EmployeeProfileData }) {
  const [contactCopied, setContactCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const getMailbox = useServerFn(getMyCorporateMailbox);
  const [mailbox, setMailbox] = useState<{ email: string; status: string; provider: string | null; created_at: string } | null>(null);

  useEffect(() => {
    getMailbox().then((value) => setMailbox(value)).catch(() => setMailbox(null));
  }, [getMailbox]);

  const copyContact = async () => {
    if (!employee.email) return;
    await navigator.clipboard?.writeText(employee.email);
    setContactCopied(true);
    window.setTimeout(() => setContactCopied(false), 1400);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await signOutCurrentUser();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSigningOut(false);
    }
  };

  const presenceLabel: Record<string, string> = {
    online: "На связи",
    away: "Отошёл",
    offline: "Не в сети",
  };
  const joinedAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : "Не указана";
  const director = employee.role === "director" || employee.position?.trim().toLocaleLowerCase("ru-RU") === "директор";

  return (
    <div className="animate-fade-in">
      <section className="border-b border-border pb-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="flex min-w-0 items-center gap-5">
            <Avatar className="h-20 w-20 rounded-lg border border-border bg-secondary shadow-sm sm:h-24 sm:w-24">
              {employee.avatar_url && <AvatarImage src={employee.avatar_url} alt={employee.full_name} />}
              <AvatarFallback className="rounded-lg bg-secondary text-2xl font-semibold text-primary">
                {employee.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {presenceLabel[employee.presence] ?? (employee.presence || "Статус не указан")}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold sm:text-3xl">{employee.full_name}</h1>
                {director && <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Директор</span>}
                {employee.is_vip && <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.16)]">✦ VIP</span>}
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
                {(director ? employee.position || "Директор" : employee.position) || "Должность не указана"} · {employee.department || "Отдел не указан"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={copyContact} disabled={!employee.email} className="active:scale-[0.98]">
              {contactCopied ? <Check /> : <AtSign />}
              {contactCopied ? "Контакт скопирован" : "Скопировать email"}
            </Button>
            <Button className="active:scale-[0.98]">
              <MessageSquare />
              Написать
            </Button>
            <Button variant="outline" onClick={() => void signOut()} disabled={signingOut} className="active:scale-[0.98]">
              <LogOut />
              {signingOut ? "Выходим…" : "Выйти"}
            </Button>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочие показатели</h2>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card xl:grid-cols-4">
              {[
                { value: "—", label: "Активных задач", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Решено за месяц", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Средний ответ", note: "Статистика профиля пока не подключена" },
                { value: "—", label: "Оценка клиентов", note: "Статистика профиля пока не подключена" },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className={`p-4 transition-colors duration-200 hover:bg-secondary/40 ${
                    index % 2 ? "border-l border-border" : ""
                  } ${index > 1 ? "border-t border-border xl:border-t-0" : ""} ${
                    index > 0 ? "xl:border-l xl:border-border" : ""
                  }`}
                >
                  <div className="text-2xl font-semibold">{item.value}</div>
                  <div className="mt-1 text-xs font-medium">{item.label}</div>
                  <div className="mt-2 text-[11px] text-muted-foreground">{item.note}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Текущая активность</h2>
            <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Данные активности для профиля пока не подключены.
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочая нагрузка</h2>
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-2xl font-semibold">—</div>
                  <p className="mt-1 text-xs text-muted-foreground">Расчёт нагрузки по задачам пока не подключён.</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium">Корпоративная почта</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              {mailbox ? <>
                <div className="break-all text-sm font-medium">{mailbox.email}</div>
                <div className="mt-2 text-xs text-muted-foreground">Статус: {{ pending: "Не подключена", active: "Активна", suspended: "Приостановлена", disabled: "Отключена", error: "Ошибка" }[mailbox.status] ?? mailbox.status}</div>
                <div className="mt-1 text-xs text-muted-foreground">Провайдер: {mailbox.provider ?? "Не настроен"}</div>
                {mailbox.status === "pending" && <p className="mt-2 text-xs text-muted-foreground">Адрес зарезервирован в NEXA. Реальный почтовый ящик пока не создан.</p>}
              </> : <p className="text-xs text-muted-foreground">Корпоративный адрес пока не назначен.</p>}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-medium">Контакты</h2>
            <div className="space-y-1 rounded-lg border border-border bg-card p-3">
              {[
                { icon: Mail, label: "Почта", value: employee.private_fields_allowed ? employee.email || "Не указана" : "Недоступна по RBAC" },
                ...(employee.private_fields_allowed ? [
                  { icon: Phone, label: "Телефон", value: employee.phone || "Не указан" },
                  { icon: MapPin, label: "Локация", value: employee.location || "Не указана" },
                ] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-3 rounded-md p-2 transition-colors hover:bg-secondary/45">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 break-words text-xs">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Рабочая информация</h2>
            <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
              {[
                { icon: BriefcaseBusiness, label: "Должность", value: employee.position || "Не указана" },
                { icon: Building2, label: "Отдел", value: employee.department || "Не указан" },
                { icon: CalendarDays, label: "Профиль создан", value: joinedAt },
                ...(employee.private_fields_allowed ? [{ icon: ShieldCheck, label: "Уровень доступа", value: employee.access_level ? `Уровень ${employee.access_level}` : "Не указан" }] : []),
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-3 py-3.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 text-xs font-medium">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
