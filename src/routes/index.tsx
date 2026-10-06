import { createFileRoute, Navigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AtSign,
  Check,
  LogOut,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, TaskWorkspace } from "@/components/nexa/TaskWorkspace";
import { getWorkspace } from "@/lib/tasks.functions";
import { BrandLogo } from "@/components/nexa/BrandLogo";

// Heavy tabs load on first open, not with the initial page.
const AdminPanel = lazy(() => import("@/components/nexa/AdminPanel").then((m) => ({ default: m.AdminPanel })));
const EmployeeDirectory = lazy(() => import("@/components/nexa/EmployeeDirectory").then((m) => ({ default: m.EmployeeDirectory })));
const KnowledgeBase = lazy(() => import("@/components/nexa/KnowledgeBase").then((m) => ({ default: m.KnowledgeBase })));
const SettingsPanel = lazy(() => import("@/components/nexa/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

function TabLoading() {
  return (
    <div role="status" className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
      Загрузка…
    </div>
  );
}
import { EditableProfileAvatar, ProfileAvatar } from "@/components/nexa/ProfileAvatar";
import { NOTIFICATIONS_QUERY_KEY, NotificationsCenter, useMyNotifications } from "@/components/nexa/NotificationsCenter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRESENCE_LABEL, ProfileCard, ProfileField, ROLE_LABEL, VipBadge, realPhone, realValue } from "@/components/nexa/profile-display";
import { getAdminAccess } from "@/lib/admin.functions";
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
      { title: "LUNO DIGITAL" },
      {
        name: "description",
        content: "LUNO DIGITAL — рабочее пространство команды: обзор, сотрудники, задачи, база знаний и уведомления.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "LUNO DIGITAL" },
      {
        property: "og:description",
        content: "LUNO DIGITAL — рабочее пространство команды.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NexaPrototype,
});

type ScreenId = "overview" | "employees" | "tickets" | "knowledge" | "settings" | "profile" | "notifications";

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
  { id: "employees", label: "Сотрудники" },
  { id: "tickets", label: "Задачи" },
  { id: "knowledge", label: "База знаний" },
  { id: "notifications", label: "Уведомления" },
  { id: "settings", label: "Настройки" },
  { id: "profile", label: "Профиль" },
];

function statusClass(status: string) {
  switch (status) {
    case "todo":
      return "bg-primary/15 text-primary";
    case "in_progress":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-secondary text-muted-foreground";
  }
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
  const queryClient = useQueryClient();
  const notifications = useMyNotifications(Boolean(currentProfile));
  const unreadNotifications = (notifications.data ?? []).filter((item) => !item.read_at).length;
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

  // After a new profile photo: reload the own profile and the directory, which show it.
  const refreshAfterAvatarChange = async () => {
    if (session) await refreshProfileAfterEmployeeSave(session.user.id);
    await queryClient.invalidateQueries({ queryKey: ["nexa", "directory"] });
  };

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
          <h1 className="text-lg font-semibold">LUNO DIGITAL временно недоступен</h1>
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
          <h1 className="font-semibold">Доступ к LUNO DIGITAL закрыт</h1>
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
          <h1 className="font-semibold">Доступ к LUNO DIGITAL закрыт</h1>
          {authGateDiagnostics?.stage === "get_my_credential_state" ? (
            // A failed credential-state check is a server/schema problem, not a
            // disabled account; show the real error instead of a generic denial.
            <p className="mt-2 text-sm text-muted-foreground">
              Не удалось проверить состояние учётных данных: {authGateDiagnostics.errorText ?? "неизвестная ошибка"}. Обратитесь к владельцу LUNO DIGITAL.
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
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6 xl:gap-6">
          <BrandLogo height={34} />

          {/* Nav with sliding indicator */}
          {/* Nav with sliding indicator */}
          <nav ref={navRef} className="relative flex h-16 min-w-0 items-center gap-0.5 overflow-x-auto xl:gap-1">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                data-screen={s.id}
                 type="button"
                onClick={() => setActive(s.id)}
                 aria-current={active === s.id ? "page" : undefined}
                className={`relative z-10 h-9 shrink-0 rounded-md px-3 text-sm transition-colors duration-200 active:scale-[0.97] ${
                  active === s.id ? "bg-secondary/70 text-foreground" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                {s.id === "notifications" && unreadNotifications > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    {s.label}
                    <span aria-label={`Непрочитанных: ${unreadNotifications}`} className="min-w-[1.125rem] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-[1.125rem] text-primary-foreground">
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  </span>
                ) : s.label}
              </button>
            ))}
            <span
              aria-hidden
              className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canOpenAdmin && <button type="button" aria-pressed={adminOpen} onClick={() => setAdminOpen((open) => !open)} className={`h-9 rounded-md px-3 text-sm transition-colors ${adminOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>Админ</button>}
            <button type="button" onClick={() => setNewRequestStep("choose")} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.98]">
              + Заявка
            </button>
            <button
              type="button"
              aria-label="Открыть профиль сотрудника"
              onClick={() => setActive("profile")}
              className="relative ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-xs font-semibold transition-all duration-200 hover:border-foreground/30 active:scale-95"
            >
              <ProfileAvatar avatarUrl={currentProfile?.avatar_url} name={currentProfile?.full_name ?? ""} initials={currentProfile?.initials ?? "NX"} className="h-full w-full rounded-[inherit]" fallbackClassName="text-xs" />
              {currentProfile?.is_vip && <span title="VIP" aria-label="VIP" className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-amber-300/40 bg-background text-[9px] text-amber-200">✦</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {currentProfile?.access_flags_error && (
          <p role="status" className="mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {safeDiagnosticError(currentProfile.access_flags_error)} Основной доступ открыт по активной сессии и профилю; дополнительные access flags будут доступны после синхронизации RPC в Cloud.
          </p>
        )}
        <Suspense fallback={<TabLoading />}>
        {adminOpen ? <AdminPanel onEmployeeSaved={refreshProfileAfterEmployeeSave} /> : active === "overview" && <Overview go={setActive} />}
        {!adminOpen && active === "employees" && <EmployeeDirectory />}
        {!adminOpen && active === "tickets" && <Tickets />}
        {!adminOpen && active === "knowledge" && <KnowledgeBase />}
        {!adminOpen && active === "notifications" && currentProfile && <AccessNotifications key={accessRequestsVersion} profile={currentProfile} />}
        {!adminOpen && active === "settings" && currentProfile && <SettingsPanel profile={currentProfile} unreadNotifications={unreadNotifications} onOpenNotifications={() => setActive("notifications")} />}
        {!adminOpen && active === "profile" && currentProfile && <EmployeeProfile employee={currentProfile} onAvatarChanged={refreshAfterAvatarChange} />}
        </Suspense>
      </main>

      <Dialog open={newRequestStep !== "closed"} onOpenChange={(open) => { if (!open) setNewRequestStep("closed"); }}>
        <DialogContent className="dark border-border bg-card text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{newRequestStep === "access" ? "Предоставление доступа" : "Новая заявка"}</DialogTitle>
            <DialogDescription>
              {newRequestStep === "access" ? "Запрос получит владелец LUNO DIGITAL. Уровень изменится только после его одобрения." : "Выберите тип заявки"}
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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 text-xs text-muted-foreground">
          <span>© LUNO DIGITAL</span>
          <span>Рабочее пространство команды</span>
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
      toast.success("Заявка отправлена владельцу LUNO DIGITAL");
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
  const queryClient = useQueryClient();
  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setRequests(await loadRequests());
    } catch (error) {
      toast.error(`Не удалось загрузить заявки: ${safeDiagnosticError(error)}`);
    } finally {
      setLoading(false);
      // Reviewing, cancelling or creating a request creates notifications server-side.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    }
  };

  // Opening a notification linked to an access request brings that request into view.
  const focusRequest = (requestId: string) => {
    setHighlightedId(requestId);
    document.getElementById(`access-request-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightedId((current) => (current === requestId ? null : current)), 2400);
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
      <SectionTitle title="Уведомления" sub="События и действия, которые требуют вашего внимания" />
      <NotificationsCenter onOpenAccessRequest={focusRequest} />

      <div className="mb-4 mt-10">
        <h2 className="text-base font-semibold">Заявки на доступ</h2>
        <p className="mt-1 text-sm text-muted-foreground">Повышение уровня доступа рассматривает только владелец LUNO DIGITAL</p>
      </div>
      {(profile.access_level ?? 1) < 5 && !loading && !hasPendingOwnRequest && (
        <section className="mb-6 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-medium">Запросить уровень доступа</h2>
          <AccessRequestForm currentLevel={profile.access_level} onSubmitted={() => void refresh()} />
        </section>
      )}

      <div className="space-y-3">
        {loading && <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Загрузка заявок…</p>}
        {!loading && requests.length === 0 && <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Заявок пока нет.</p>}
        {requests.map((request) => (
          <article
            key={request.id}
            id={`access-request-${request.id}`}
            className={`scroll-mt-24 rounded-lg border bg-card p-5 transition-colors duration-700 ${highlightedId === request.id ? "border-primary/50" : "border-border"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{request.notification_title ?? "Заявка на предоставление доступа"}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{request.employee_name} · текущий уровень {request.current_level} · запрошен уровень {request.requested_level}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${request.status === "pending" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>{ACCESS_STATUS_LABEL[request.status]}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{request.reason}</p>
            <p className="mt-3 text-xs text-muted-foreground">Создана: {formatDateTime(request.created_at)}</p>
            {request.reviewed_at && <p className="mt-1 text-xs text-muted-foreground">Решение принял владелец LUNO DIGITAL{request.reviewer_name ? ` · ${request.reviewer_name}` : ""} · {formatDateTime(request.reviewed_at)}</p>}
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
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

// Same query key as TaskWorkspace, so both screens share one cached copy of
// the workspace (tasks of projects the user may access under RLS + profiles).
const WORKSPACE_QUERY_KEY = ["nexa", "workspace"] as const;
const ACTIVE_STATUSES = new Set(["todo", "in_progress", "waiting"]);
const DAY_MS = 24 * 60 * 60 * 1000;

type OverviewStat = { label: string; value: string; delta: string; empty?: boolean };

function Overview({ go }: { go: (s: ScreenId) => void }) {
  const loadWorkspace = useServerFn(getWorkspace);
  const workspace = useQuery({ queryKey: WORKSPACE_QUERY_KEY, queryFn: () => loadWorkspace() });
  const data = workspace.data;

  const tasks = data?.tasks ?? [];
  const now = Date.now();
  const openTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const createdLastDay = tasks.filter((task) => now - new Date(task.created_at).getTime() < DAY_MS).length;
  // Deadline compliance from real fields: completed tasks that had a due date.
  const completedWithDeadline = tasks.filter((task) => task.status === "done" && task.due_at && task.completed_at);
  const completedOnTime = completedWithDeadline.filter((task) => new Date(task.completed_at!).getTime() <= new Date(task.due_at!).getTime());
  const recentTasks = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);

  // Team load: active tasks per assignee, as a share of all active assigned tasks.
  const activeAssigned = openTasks.filter((task) => task.assignee_id);
  const loadByAssignee = new Map<string, number>();
  for (const task of activeAssigned) loadByAssignee.set(task.assignee_id!, (loadByAssignee.get(task.assignee_id!) ?? 0) + 1);
  const teamLoad = [...loadByAssignee.entries()]
    .map(([id, count]) => ({
      id,
      name: data?.profiles.find((profile) => profile.id === id)?.full_name || "Сотрудник",
      count,
      share: Math.round((count / activeAssigned.length) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    .slice(0, 5);

  const stats: OverviewStat[] = [
    {
      label: "Открытые задачи",
      value: data ? String(openTasks.length) : "—",
      delta: data ? `+${createdLastDay} за сутки` : "",
    },
    { label: "Среднее время ответа", value: "—", delta: "Нет данных: время ответа не фиксируется", empty: true },
    completedWithDeadline.length > 0
      ? {
          label: "Соблюдение сроков",
          value: `${Math.round((completedOnTime.length / completedWithDeadline.length) * 100)}%`,
          delta: `${completedOnTime.length} из ${completedWithDeadline.length} завершены в срок`,
        }
      : { label: "Соблюдение сроков", value: "—", delta: "Нет данных: нет завершённых задач со сроком", empty: true },
    { label: "CSAT", value: "—", delta: "Нет данных: оценки клиентов не собираются", empty: true },
  ];

  return (
    <div>
      <SectionTitle title="Обзор" sub="Ключевые показатели по задачам, доступным вам" />
      {workspace.error && (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Не удалось загрузить данные: {(workspace.error as Error).message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-5">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`mt-3 text-3xl font-semibold tracking-tight ${s.empty ? "text-muted-foreground" : ""}`}>
              {workspace.isLoading && !s.empty ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-secondary align-middle" /> : s.value}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">Последние задачи</h2>
            <button type="button" onClick={() => go("tickets")} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Открыть задачи →
            </button>
          </div>
          {workspace.isLoading ? (
            <p className="py-2.5 text-sm text-muted-foreground">Загрузка задач…</p>
          ) : recentTasks.length === 0 ? (
            <p className="py-2.5 text-sm text-muted-foreground">Задач пока нет.</p>
          ) : (
            <div className="divide-y divide-border">
              {recentTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-20 font-mono text-xs text-muted-foreground">#{t.number}</span>
                  <span className="flex-1 truncate" title={t.title}>{t.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(t.status)}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-medium">Нагрузка команды</h2>
          {workspace.isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : teamLoad.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет сотрудников с активными задачами.</p>
          ) : (
            teamLoad.map((a) => (
              <div key={a.id} className="mb-3">
                <div className="mb-1 flex justify-between gap-3 text-xs">
                  <span className="truncate" title={a.name}>{a.name}</span>
                  <span className="shrink-0 text-muted-foreground">{a.count} · {a.share}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${a.share}%` }} />
                </div>
              </div>
            ))
          )}
          {teamLoad.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Доля активных назначенных задач</p>}
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

function EmployeeProfile({ employee, onAvatarChanged }: { employee: EmployeeProfileData; onAvatarChanged: () => Promise<void> }) {
  const [contactCopied, setContactCopied] = useState(false);

  const copyContact = async () => {
    if (!employee.email) return;
    await navigator.clipboard?.writeText(employee.email);
    setContactCopied(true);
    window.setTimeout(() => setContactCopied(false), 1400);
  };

  const joinedAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : null;
  const director = employee.role === "director" || employee.position?.trim().toLocaleLowerCase("ru-RU") === "директор";
  const position = (director ? employee.position || "Директор" : employee.position) || null;
  const presence = PRESENCE_LABEL[employee.presence] ?? (employee.presence || null);
  const online = employee.presence === "online";
  // Contacts list only fields that actually have a value the viewer may see.
  const levelLabel = employee.access_level !== null ? `Level ${employee.access_level}` : "—";
  const email = realValue(employee.email);
  const phone = realPhone(employee.phone);
  const location = realValue(employee.location);

  return (
    <div className="animate-fade-in space-y-4">
      <section className="rounded-xl border border-border bg-card px-6 py-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <EditableProfileAvatar avatarUrl={employee.avatar_url} name={employee.full_name} initials={employee.initials} onUploaded={onAvatarChanged} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{employee.full_name}</h1>
                {director && <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Директор</span>}
                {employee.is_vip && <VipBadge />}
              </div>
              {(position || employee.department) && (
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">{[position, employee.department].filter(Boolean).join(" · ")}</p>
              )}
              {presence && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-muted-foreground/60"}`} />
                  {presence}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copyContact()} disabled={!email} className="active:scale-[0.98]">
              {contactCopied ? <Check /> : <AtSign />}
              {contactCopied ? "Скопировано" : "Скопировать email"}
            </Button>
            <Button className="active:scale-[0.98]">
              <MessageSquare />
              Написать
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <ProfileCard title="Доступ">
          <div className="mb-4 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight">{levelLabel}</span>
            <span className="text-xs text-muted-foreground">уровень доступа</span>
          </div>
          <dl className="divide-y divide-border border-t border-border pt-2.5">
            <ProfileField label="Роль" value={employee.role ? ROLE_LABEL[employee.role] ?? employee.role : "Не указана"} muted={!employee.role} />
            <ProfileField
              label="Статус"
              value={<span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${employee.is_active ? "bg-emerald-400" : "bg-destructive"}`} />{employee.is_active ? "Активен" : "Неактивен"}</span>}
            />
            <ProfileField label="VIP" value={employee.is_vip ? "Да" : "Нет"} muted={!employee.is_vip} />
          </dl>
        </ProfileCard>

        <ProfileCard title="Контакты">
          <dl className="divide-y divide-border">
            <ProfileField label="Email" value={email ?? "Не указан"} muted={!email} />
            {employee.private_fields_allowed && <ProfileField label="Телефон" value={phone ?? "Не указан"} muted={!phone} />}
            {employee.private_fields_allowed && <ProfileField label="Локация" value={location ?? "Не указана"} muted={!location} />}
          </dl>
        </ProfileCard>
      </div>

      <ProfileCard title="Рабочая информация">
        <dl className="divide-y divide-border">
          <ProfileField label="Должность" value={position ?? "Не указана"} muted={!position} />
          <ProfileField label="Отдел" value={employee.department || "Не указан"} muted={!employee.department} />
          <ProfileField label="Профиль создан" value={joinedAt ?? "Не указана"} muted={!joinedAt} />
        </dl>
      </ProfileCard>
    </div>
  );
}
