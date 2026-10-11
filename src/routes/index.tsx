import { createFileRoute, Navigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LayoutGrid,
  ListChecks,
  ListTodo,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Plus,
  Settings,
  ShieldCheck,
  Target,
  Timer,
  UserRound,
  Users,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { EASE_OUT_SOFT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_LABEL, useTaskRealtime } from "@/components/nexa/task-data";
import { getWorkspace } from "@/lib/tasks.functions";
import { formatDuration } from "@/lib/nexa-session";
import { BrandLogo } from "@/components/nexa/BrandLogo";
import { StatusScreen } from "@/components/nexa/StatusScreen";
import { WhatsNewDialog } from "@/components/nexa/WhatsNewDialog";
import { DesktopNav, MobileTabBar, type NavItem } from "@/components/nexa/AppNav";

// Heavy tabs load on first open, not with the initial page.
const AdminPanel = lazy(() => import("@/components/nexa/AdminPanel").then((m) => ({ default: m.AdminPanel })));
const EmployeeDirectory = lazy(() => import("@/components/nexa/EmployeeDirectory").then((m) => ({ default: m.EmployeeDirectory })));
const KnowledgeBase = lazy(() => import("@/components/nexa/KnowledgeBase").then((m) => ({ default: m.KnowledgeBase })));
// The Tasks tab (and its motion-heavy UI) is a separate chunk: it loads on the
// first visit to "Задачи" and is prefetched when the user points at the tab.
const loadTaskWorkspace = () => import("@/components/nexa/TaskWorkspace");
const TaskWorkspace = lazy(() => loadTaskWorkspace().then((m) => ({ default: m.TaskWorkspace })));
let taskWorkspacePrefetched = false;
function prefetchTaskWorkspace() {
  if (taskWorkspacePrefetched) return;
  taskWorkspacePrefetched = true;
  void loadTaskWorkspace().catch(() => {
    taskWorkspacePrefetched = false;
  });
}
const SettingsPanel = lazy(() => import("@/components/nexa/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

function TabLoading() {
  return (
    <div role="status" aria-label="Загрузка" className="flex min-h-48 items-center justify-center">
      <div aria-hidden className="luno-progress" />
    </div>
  );
}
import { EditableProfileAvatar, ProfileAvatar } from "@/components/nexa/ProfileAvatar";
import { NOTIFICATIONS_QUERY_KEY, NotificationsCenter, useMyNotifications } from "@/components/nexa/NotificationsCenter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AccessLevelValue,
  ActiveValue,
  CopyValueButton,
  EmployeeName,
  FactTiles,
  InfoGroup,
  InfoRow,
  PresenceBadge,
  ProfileHero,
  ROLE_LABEL,
  realPhone,
  realValue,
} from "@/components/nexa/profile-display";
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
import { startPresence, stopPresence, useIsOnline } from "@/lib/presence";
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

const SCREENS: { id: ScreenId; label: string; icon: NavItem<ScreenId>["icon"] }[] = [
  { id: "overview", label: "Обзор", icon: LayoutGrid },
  { id: "employees", label: "Сотрудники", icon: Users },
  { id: "tickets", label: "Задачи", icon: ListChecks },
  { id: "knowledge", label: "База знаний", icon: BookOpen },
  { id: "notifications", label: "Уведомления", icon: Bell },
  { id: "settings", label: "Настройки", icon: Settings },
  { id: "profile", label: "Профиль", icon: UserRound },
];

/** What the main area shows: a screen, or the Admin Panel on top of it. */
type ViewId = ScreenId | "admin";

// Phones: these sections sit in the bottom bar, the rest in its "Ещё" menu.
const MOBILE_PRIMARY: ScreenId[] = ["overview", "tickets", "employees", "notifications"];

function statusClass(status: string) {
  switch (status) {
    case "in_progress":
      return "bg-primary-soft text-primary";
    case "waiting":
      return "bg-warning/12 text-warning";
    case "todo":
      return "bg-secondary text-foreground-secondary";
    default:
      return "bg-secondary/60 text-muted-foreground";
  }
}


function NexaPrototype() {
  const [active, setActive] = useState<ScreenId>("overview");
  // "Задачи сотрудника" from the profile opens Tasks pre-filtered to "Мои задачи".
  const [tasksMineOnly, setTasksMineOnly] = useState(false);
  // A task picked on Overview opens selected in Tasks.
  const [tasksFocusId, setTasksFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (active !== "tickets") {
      setTasksMineOnly(false);
      setTasksFocusId(null);
    }
  }, [active]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [newRequestStep, setNewRequestStep] = useState<"closed" | "choose" | "access">("closed");
  const [accessRequestsVersion, setAccessRequestsVersion] = useState(0);
  const [canOpenAdmin, setCanOpenAdmin] = useState(false);
  // The full auth check is keyed by user id: a repeated SIGNED_IN or a
  // TOKEN_REFRESHED for the same user replaces the session object but must not
  // re-run the check or bring back the "Проверяем сессию…" screen.
  const [workspaceAccessUserId, setWorkspaceAccessUserId] = useState<string | null>(null);
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
  const sessionUserId = session?.user.id ?? null;
  const headerRef = useRef<HTMLElement>(null);

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
            setWorkspaceAccessUserId(session.user.id);
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
          setWorkspaceAccessUserId(session.user.id);
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
          setWorkspaceAccessUserId(session.user.id);
          setBlockedSession(session);
        }
      })();
    }
    return () => { live = false; };
  }, [sessionUserId, loadCurrentProfile, loadAuthGateDiagnostics, loadCredentialState, checkAdmin, authCheckAttempt]);

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
  }, [active, sessionUserId, blockedSession, loadCurrentProfile]);

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

  // Realtime Presence runs once for the signed-in user who passed the auth
  // gate; it stops on sign-out, a user change or a blocked session.
  const presenceUserId = session && workspaceAccessUserId === session.user.id && !blockedSession ? session.user.id : null;
  useEffect(() => {
    if (!presenceUserId) return;
    startPresence(presenceUserId);
    return () => stopPresence();
  }, [presenceUserId]);

  // No dependency list: the header mounts only after the auth gate, so the
  // listener attaches on the first render where it exists (cheap re-binding).
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const sync = () => {
      if (window.scrollY > 0) header.setAttribute("data-scrolled", "");
      else header.removeAttribute("data-scrolled");
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  });

  if (loading || session && workspaceAccessUserId !== session.user.id) {
    // Branded pause between sign-in and the workspace, on the same backdrop.
    return (
      <div
        role="status"
        aria-live="polite"
        className="dark flex min-h-screen flex-col items-center justify-center gap-6 text-foreground"
      >
        <BrandLogo variant="light" height={44} className="luno-rise" />
        <div aria-hidden className="luno-progress luno-rise" style={{ animationDelay: "120ms" }} />
        <span
          className="luno-rise text-caption text-muted-foreground"
          style={{ animationDelay: "200ms" }}
        >
          Проверяем сессию…
        </span>
      </div>
    );
  }

  if (connectionError) {
    return (
      <StatusScreen
        icon={WifiOff}
        tone="warning"
        role="alert"
        title="LUNO DIGITAL временно недоступен"
        actions={
          <Button className="rounded-full px-5" onClick={() => window.location.reload()}>
            Повторить
          </Button>
        }
      >
        Не удалось подключиться к рабочему пространству. Повторите попытку позже.
      </StatusScreen>
    );
  }

  if (!session) return <Navigate to="/auth" />;
  if (credentialGate === "change") return <Navigate to="/change-password" />;
  if (credentialGate === "expired") {
    return (
      <StatusScreen
        icon={LockKeyhole}
        tone="danger"
        role="alert"
        title="Доступ к LUNO DIGITAL закрыт"
        actions={
          <Button
            variant="outline"
            className="rounded-full px-5"
            onClick={() =>
              void signOutCurrentUser().catch((error: Error) => toast.error(error.message))
            }
          >
            <LogOut />
            Выйти
          </Button>
        }
      >
        {TEMPORARY_PASSWORD_EXPIRED_MESSAGE}
      </StatusScreen>
    );
  }
  if (blockedSession === session) {
    return (
      <StatusScreen
        icon={LockKeyhole}
        tone="danger"
        role="alert"
        title="Доступ к LUNO DIGITAL закрыт"
        actions={
          <>
            <Button
              className="rounded-full px-5"
              onClick={() => {
                setBlockedSession(null);
                setWorkspaceAccessUserId(null);
                setCurrentProfile(null);
                setAuthCheckAttempt((attempt) => attempt + 1);
              }}
            >
              Повторить проверку
            </Button>
            <Button
              variant="outline"
              className="rounded-full px-5"
              onClick={() =>
                void signOutCurrentUser().catch((error: Error) => toast.error(error.message))
              }
            >
              <LogOut />
              Выйти
            </Button>
          </>
        }
        footer={
          import.meta.env.DEV && authGateDiagnostics ? (
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
          ) : undefined
        }
      >
        {authGateDiagnostics?.stage === "get_my_credential_state" ? (
          // A failed credential-state check is a server/schema problem, not a
          // disabled account; show the real error instead of a generic denial.
          <p>
            Не удалось проверить состояние учётных данных:{" "}
            {authGateDiagnostics.errorText ?? "неизвестная ошибка"}. Обратитесь к владельцу LUNO
            DIGITAL.
          </p>
        ) : (
          <p>
            Учётная запись отключена или не удалось подтвердить доступ. Обратитесь к администратору.
          </p>
        )}
      </StatusScreen>
    );
  }

  // One selection model for every navigation surface: choosing a section
  // closes the Admin Panel; "Админ" toggles it as before.
  const view: ViewId = adminOpen ? "admin" : active;
  const selectView = (id: ViewId) => {
    if (id === "admin") {
      setAdminOpen((open) => !open);
      return;
    }
    setAdminOpen(false);
    setActive(id);
  };
  const navItems: NavItem<ViewId>[] = SCREENS.map((screen) => ({
    ...screen,
    ...(screen.id === "notifications" && unreadNotifications > 0
      ? { badge: unreadNotifications }
      : {}),
    ...(screen.id === "tickets" ? { onIntent: prefetchTaskWorkspace } : {}),
  }));
  const adminItem: NavItem<ViewId> = {
    id: "admin",
    label: "Админ",
    icon: ShieldCheck,
    separated: true,
  };
  const desktopItems = canOpenAdmin ? [...navItems, adminItem] : navItems;
  const mobilePrimary = navItems.filter((item) => MOBILE_PRIMARY.includes(item.id as ScreenId));
  const mobileMore = [
    ...navItems.filter((item) => !MOBILE_PRIMARY.includes(item.id as ScreenId)),
    ...(canOpenAdmin ? [{ ...adminItem, separated: false }] : []),
  ];

  return (
    <div className="dark min-h-screen text-foreground">
      {/* Transparent over the backdrop at the top; a glass bar once content
          scrolls under it (data-scrolled is set without a re-render). */}
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-transparent transition-[background-color,border-color] duration-300 data-[scrolled]:border-border data-[scrolled]:bg-background/75 data-[scrolled]:backdrop-blur-xl data-[scrolled]:backdrop-saturate-150"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-4">
          <button
            type="button"
            aria-label="LUNO DIGITAL — обзор"
            onClick={() => selectView("overview")}
            className="shrink-0 rounded-md transition-[opacity,scale] duration-200 hover:opacity-90 active:scale-[0.97]"
          >
            <BrandLogo variant="light" height={32} />
          </button>

          <div className="flex min-w-0 flex-1 justify-center">
            <DesktopNav items={desktopItems} current={view} onSelect={selectView} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              onClick={() => setNewRequestStep("choose")}
              className="h-9 rounded-full px-3 sm:px-4"
              aria-label="Новая заявка"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Заявка</span>
            </Button>
            <button
              type="button"
              aria-label="Открыть профиль сотрудника"
              aria-current={view === "profile" ? "page" : undefined}
              onClick={() => selectView("profile")}
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 transition-[box-shadow,scale] duration-200 ease-(--ease-spring) active:scale-95 ${view === "profile" ? "ring-2 ring-primary/70" : "ring-border-strong hover:ring-foreground/30"}`}
            >
              <ProfileAvatar
                avatarUrl={currentProfile?.avatar_url}
                name={currentProfile?.full_name ?? ""}
                initials={currentProfile?.initials ?? "NX"}
                className="h-full w-full rounded-full"
                fallbackClassName="text-xs"
              />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:pb-14 md:pt-8">
        {currentProfile?.access_flags_error && (
          <p role="status" className="mb-5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
            {safeDiagnosticError(currentProfile.access_flags_error)} Основной доступ открыт по активной сессии и профилю; дополнительные access flags будут доступны после синхронизации RPC в Cloud.
          </p>
        )}
        <Suspense fallback={<TabLoading />}>
          {/* Keyed by the view: every screen enters with the cascade from styles.css (.luno-view). */}
          <div key={view} className="luno-view">
            {view === "admin" && <AdminPanel onEmployeeSaved={refreshProfileAfterEmployeeSave} />}
            {view === "overview" && (
              <Overview
                go={selectView}
                onOpenTask={(taskId) => {
                  setTasksFocusId(taskId);
                  selectView("tickets");
                }}
              />
            )}
            {view === "employees" && <EmployeeDirectory />}
            {view === "tickets" && (
              <Tickets initialMineOnly={tasksMineOnly} initialTaskId={tasksFocusId} />
            )}
            {view === "knowledge" && <KnowledgeBase />}
            {view === "notifications" && currentProfile && (
              <AccessNotifications key={accessRequestsVersion} profile={currentProfile} />
            )}
            {view === "settings" && currentProfile && (
              <SettingsPanel
                profile={currentProfile}
                unreadNotifications={unreadNotifications}
                onOpenNotifications={() => selectView("notifications")}
              />
            )}
            {view === "profile" && currentProfile && (
              <EmployeeProfile
                employee={currentProfile}
                onAvatarChanged={refreshAfterAvatarChange}
                onOpenTasks={() => {
                  setTasksMineOnly(true);
                  selectView("tickets");
                }}
              />
            )}
          </div>
        </Suspense>
      </main>

      <Dialog open={newRequestStep !== "closed"} onOpenChange={(open) => { if (!open) setNewRequestStep("closed"); }}>
        <DialogContent className="dark text-foreground sm:max-w-lg">
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
                className="group rounded-card border border-border bg-field p-4 text-left transition-[border-color,background-color,translate,scale] duration-200 ease-(--ease-spring) hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft active:scale-[0.98]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <ListChecks className="h-[18px] w-[18px]" />
                </span>
                <div className="mt-3 text-sm font-medium">Задача</div>
                <div className="mt-1 text-caption text-muted-foreground">
                  Создать задачу в проекте
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewRequestStep("access")}
                className="group rounded-card border border-border bg-field p-4 text-left transition-[border-color,background-color,translate,scale] duration-200 ease-(--ease-spring) hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft active:scale-[0.98]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <KeyRound className="h-[18px] w-[18px]" />
                </span>
                <div className="mt-3 text-sm font-medium">Предоставление доступа</div>
                <div className="mt-1 text-caption text-muted-foreground">
                  Запросить более высокий уровень доступа
                </div>
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

      <footer className="hidden md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-border px-6 py-5 text-caption text-muted-foreground">
          <span>© LUNO DIGITAL</span>
          <span>Рабочее пространство команды</span>
        </div>
      </footer>

      {/* Release notes of the current version, once per user and version. */}
      <WhatsNewDialog userId={session.user.id} />

      <MobileTabBar
        primary={mobilePrimary}
        more={mobileMore}
        current={view}
        onSelect={selectView}
      />
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

function AccessRequestForm({
  currentLevel,
  onSubmitted,
  onCancel,
  cancelLabel = "Назад",
}: {
  currentLevel: number | null;
  onSubmitted: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const submitRequest = useServerFn(createAccessLevelRequest);
  const level = currentLevel ?? 1;
  const levels = Array.from({ length: Math.max(0, 5 - level) }, (_, index) => level + index + 1);
  const [requestedLevel, setRequestedLevel] = useState(String(Math.min(5, level + 1)));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (levels.length === 0) {
    return (
      <p className="text-callout text-muted-foreground">У вас уже максимальный уровень доступа.</p>
    );
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
    <form onSubmit={submit} className="space-y-4">
      <p className="text-callout text-muted-foreground">
        Текущий уровень: {currentLevel ?? "не определён"}. Уровень изменится только после решения
        владельца.
      </p>
      <div className="space-y-1.5">
        <label
          htmlFor="access-request-level"
          className="text-caption font-medium text-muted-foreground"
        >
          Запрошенный уровень
        </label>
        <NativeSelect
          id="access-request-level"
          icon={KeyRound}
          value={requestedLevel}
          onChange={(event) => setRequestedLevel(event.target.value)}
          className="h-10"
        >
          {levels.map((option) => (
            <option key={option} value={option}>
              Уровень {option}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="access-request-reason"
          className="text-caption font-medium text-muted-foreground"
        >
          Причина
        </label>
        <Textarea
          id="access-request-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          maxLength={2000}
          required
          rows={3}
          className="resize-y"
          placeholder="Опишите, зачем нужен новый уровень"
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" className="rounded-full px-5" disabled={saving}>
          {saving ? "Отправка…" : "Отправить владельцу"}
        </Button>
      </div>
    </form>
  );
}

/** Status pill of an access request: pending pulses softly, decisions are quiet. */
function AccessStatusBadge({ status }: { status: AccessRequestItem["status"] }) {
  const tone =
    status === "pending"
      ? "border-primary/25 bg-primary-soft text-primary"
      : status === "approved"
        ? "border-success/25 bg-success/10 text-success"
        : status === "rejected"
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : "border-border bg-secondary/70 text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium ${tone}`}
    >
      {status === "pending" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-50 motion-reduce:hidden" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      )}
      {ACCESS_STATUS_LABEL[status]}
    </span>
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
  // UI-only: the request form stays folded behind its button.
  const [formOpen, setFormOpen] = useState(false);

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
  const canRequest = (profile.access_level ?? 1) < 5 && !loading && !hasPendingOwnRequest;

  return (
    <div>
      <SectionTitle title="Уведомления" sub="События и действия, которые требуют вашего внимания" />
      <div className="grid items-start gap-x-6 gap-y-10 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <NotificationsCenter onOpenAccessRequest={focusRequest} />

        <section aria-labelledby="access-requests-title" className="min-w-0">
          <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="access-requests-title" className="text-title-3">
                Заявки на доступ
              </h2>
              <p className="text-callout text-muted-foreground">
                Повышение уровня рассматривает только владелец LUNO DIGITAL
              </p>
            </div>
            {canRequest && !formOpen && (
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full px-3.5"
                onClick={() => setFormOpen(true)}
              >
                <KeyRound />
                Запросить уровень
              </Button>
            )}
          </div>

          <AnimatePresence initial={false}>
            {canRequest && formOpen && (
              <motion.div
                key="request-form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease: EASE_OUT_SOFT }}
                className="overflow-hidden"
              >
                <div className="mb-4 rounded-card border border-border bg-card p-5">
                  <h3 className="mb-3 text-body font-semibold">Запросить уровень доступа</h3>
                  <AccessRequestForm
                    currentLevel={profile.access_level}
                    onSubmitted={() => {
                      setFormOpen(false);
                      void refresh();
                    }}
                    onCancel={() => setFormOpen(false)}
                    cancelLabel="Отмена"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            {loading && (
              <div
                className="h-28 animate-pulse rounded-card border border-border bg-card"
                aria-label="Загрузка заявок"
              />
            )}
            {!loading && requests.length === 0 && (
              <div className="flex flex-col items-center rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-body font-medium">Заявок пока нет</p>
                <p className="mt-1 text-callout text-muted-foreground">
                  Здесь появятся ваши запросы и их решения.
                </p>
              </div>
            )}
            {requests.map((request) => (
              <article
                key={request.id}
                id={`access-request-${request.id}`}
                className={`scroll-mt-24 rounded-card border bg-card p-5 transition-[border-color,box-shadow] duration-700 ${highlightedId === request.id ? "border-primary/60 shadow-[0_0_0_4px_oklch(0.724_0.187_48.9/0.15),0_0_32px_-8px_oklch(0.724_0.187_48.9/0.5)]" : "border-border"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary-soft text-primary">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-body font-semibold">
                        {request.notification_title ?? "Заявка на предоставление доступа"}
                      </h3>
                      <p className="mt-0.5 text-caption text-muted-foreground">
                        {request.employee_name} · уровень {request.current_level} →{" "}
                        {request.requested_level}
                      </p>
                    </div>
                  </div>
                  <AccessStatusBadge status={request.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-border bg-background/40 px-3.5 py-2.5 text-body">
                  {request.reason}
                </p>
                <div className="mt-3 space-y-1 text-caption text-muted-foreground">
                  <p>Создана: {formatDateTime(request.created_at)}</p>
                  {request.reviewed_at && (
                    <p>
                      Решение принял владелец LUNO DIGITAL
                      {request.reviewer_name ? ` · ${request.reviewer_name}` : ""} ·{" "}
                      {formatDateTime(request.reviewed_at)}
                    </p>
                  )}
                  {request.cancelled_at && (
                    <p>Отменена сотрудником · {formatDateTime(request.cancelled_at)}</p>
                  )}
                </div>
                {request.is_owner_review && request.status === "pending" && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      className="rounded-full px-4"
                      disabled={saving}
                      onClick={() => void review(request.id, "approved")}
                    >
                      {saving ? "Сохранение…" : "Одобрить"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full px-4"
                      disabled={saving}
                      onClick={() => void review(request.id, "rejected")}
                    >
                      Отклонить
                    </Button>
                    <span className="text-caption text-primary">
                      {request.action_label ?? "Рассмотреть"}
                    </span>
                  </div>
                )}
                {request.can_cancel && !request.is_owner_review && (
                  <div className="mt-4 border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full px-4"
                      disabled={saving}
                      onClick={() => void cancel(request.id)}
                    >
                      Отменить заявку
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-title-1">{title}</h1>
      <p className="mt-2 text-body text-muted-foreground">{sub}</p>
    </div>
  );
}

// Same query key as TaskWorkspace, so both screens share one cached copy of
// the workspace (tasks of projects the user may access under RLS + profiles).
const WORKSPACE_QUERY_KEY = ["nexa", "workspace"] as const;
const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const DAY_MS = 24 * 60 * 60 * 1000;

type Kpi = { label: string; value: string | null; caption: string };

const KPI_ICONS = [ListTodo, Timer, Target, CheckCircle2] as const;

/**
 * Counts a numeric KPI ("12", "86%") up to its new value instead of swapping
 * it; anything else is shown as is. Instant under reduced motion and when
 * animations are off in Settings (MotionGlobalConfig).
 */
function AnimatedValue({ value }: { value: string }) {
  const parsed = /^(\d+)(.*)$/.exec(value);
  const target = parsed ? Number(parsed[1]) : null;
  const suffix = parsed?.[2] ?? "";
  const shown = useRef(0);
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState(() => (target === null ? value : `0${suffix}`));
  useEffect(() => {
    if (target === null) {
      setText(value);
      return;
    }
    const controls = animate(shown.current, target, {
      duration: reduceMotion ? 0 : 0.9,
      ease: EASE_OUT_SOFT,
      onUpdate: (latest) => {
        shown.current = latest;
        setText(`${Math.round(latest)}${suffix}`);
      },
    });
    return () => controls.stop();
  }, [target, suffix, value, reduceMotion]);
  return <>{text}</>;
}

/** One KPI tile. A changed value counts to its new number and is briefly tinted; no loops. */
function KpiCard({
  kpi,
  loading,
  icon: Icon,
}: {
  kpi: Kpi;
  loading: boolean;
  icon: (typeof KPI_ICONS)[number];
}) {
  const previous = useRef(kpi.value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (previous.current === kpi.value) return;
    const first = previous.current === null;
    previous.current = kpi.value;
    if (first) return;
    setChanged(true);
    const timer = window.setTimeout(() => setChanged(false), 1400);
    return () => window.clearTimeout(timer);
  }, [kpi.value]);
  return (
    <div className="group relative overflow-hidden rounded-card border border-border bg-card p-4 transition-[border-color,translate] duration-300 ease-(--ease-out-soft) hover:-translate-y-0.5 hover:border-border-strong sm:p-5">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary/70 text-foreground-secondary transition-colors duration-300 group-hover:text-primary"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="mt-4 text-callout text-muted-foreground">{kpi.label}</div>
      <div
        className={`mt-1 text-metric tabular-nums transition-colors duration-700 motion-reduce:transition-none ${kpi.value === null ? "text-muted-foreground" : changed ? "text-primary" : "text-foreground"}`}
      >
        {loading ? (
          <span className="inline-block h-8 w-14 animate-pulse rounded-lg bg-secondary align-middle motion-reduce:animate-none" />
        ) : kpi.value === null ? (
          "—"
        ) : (
          <AnimatedValue value={kpi.value} />
        )}
      </div>
      <div className="mt-1.5 line-clamp-3 text-caption text-muted-foreground lg:line-clamp-2">
        {loading ? "\u00a0" : kpi.caption}
      </div>
    </div>
  );
}

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0";
}

function Overview({
  go,
  onOpenTask,
}: {
  go: (s: ScreenId) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const loadWorkspace = useServerFn(getWorkspace);
  const workspace = useQuery({ queryKey: WORKSPACE_QUERY_KEY, queryFn: () => loadWorkspace() });
  // Same realtime channel as the Tasks tab: task / timer changes refresh the workspace cache.
  const realtime = useTaskRealtime();
  const data = workspace.data;
  const live = realtime === "live" && !workspace.isError;

  const tasks = data?.tasks ?? [];
  const running = data?.running ?? [];
  const now = Date.now();
  const time = (value: string | null) => (value ? new Date(value).getTime() : NaN);

  // Tasks of completed projects keep their own status but are frozen, so they
  // do not count as active work (open / in progress / team load).
  const completedProjects = new Set((data?.projects ?? []).filter((project) => project.status === "completed").map((project) => project.id));
  const openTasks = tasks.filter((task) => !CLOSED_STATUSES.has(task.status) && !completedProjects.has(task.project_id));
  const createdLastDay = tasks.filter((task) => now - time(task.created_at) < DAY_MS).length;
  const inProgress = openTasks.filter((task) => task.status === "in_progress");
  const runningTaskIds = new Set(running.map((entry) => entry.task_id));
  // Deadline compliance: completed tasks that had a due date; on time when completed_at <= due_at.
  const doneWithDue = tasks.filter((task) => task.status === "done" && task.due_at && task.completed_at);
  const doneOnTime = doneWithDue.filter((task) => time(task.completed_at) <= time(task.due_at));
  const overdueOpen = openTasks.filter((task) => task.due_at && time(task.due_at) < now).length;
  // Completed in the last 7 days vs the 7 days before, by completed_at of currently completed tasks.
  const completedBetween = (from: number, to: number) =>
    tasks.filter((task) => task.status === "done" && task.completed_at && time(task.completed_at) >= from && time(task.completed_at) < to).length;
  const doneLast7 = completedBetween(now - 7 * DAY_MS, now + 1);
  const donePrev7 = completedBetween(now - 14 * DAY_MS, now - 7 * DAY_MS);

  const kpis: Kpi[] = data
    ? [
        { label: "Открытые задачи", value: String(openTasks.length), caption: `${signed(createdLastDay)} создано за сутки` },
        {
          label: "В работе",
          value: String(inProgress.length),
          caption: runningTaskIds.size > 0 ? `Таймер идёт: ${runningTaskIds.size} ${pluralRu(runningTaskIds.size, "задача", "задачи", "задач")}` : "Таймеры не запущены",
        },
        doneWithDue.length > 0
          ? {
              label: "Соблюдение сроков",
              value: `${Math.round((doneOnTime.length / doneWithDue.length) * 100)}%`,
              caption: `${doneOnTime.length} из ${doneWithDue.length} в срок${overdueOpen ? ` · просрочено ${overdueOpen}` : ""}`,
            }
          : { label: "Соблюдение сроков", value: null, caption: overdueOpen ? `Нет завершённых со сроком · просрочено ${overdueOpen}` : "Нет завершённых задач со сроком" },
        { label: "Завершено за 7 дней", value: String(doneLast7), caption: `${signed(doneLast7 - donePrev7)} к прошлым 7 дням` },
      ]
    : ["Открытые задачи", "В работе", "Соблюдение сроков", "Завершено за 7 дней"].map((label) => ({ label, value: null, caption: "" }));

  // Latest activity first: updated_at changes on status, timer and field edits.
  const recentTasks = [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const nameOf = (id: string | null) => (id ? data?.profiles.find((profile) => profile.id === id)?.full_name || "Сотрудник" : null);
  const isVipOf = (id: string | null) => Boolean(id && data?.profiles.find((profile) => profile.id === id)?.is_vip);

  // Team load: open tasks per assignee, as a share of all open assigned tasks.
  const openAssigned = openTasks.filter((task) => task.assignee_id);
  const loadByAssignee = new Map<string, { count: number; inProgress: number }>();
  for (const task of openAssigned) {
    const entry = loadByAssignee.get(task.assignee_id!) ?? { count: 0, inProgress: 0 };
    entry.count += 1;
    if (task.status === "in_progress") entry.inProgress += 1;
    loadByAssignee.set(task.assignee_id!, entry);
  }
  const teamLoad = [...loadByAssignee.entries()]
    .map(([id, entry]) => ({ id, name: nameOf(id) ?? "Сотрудник", ...entry, share: Math.round((entry.count / openAssigned.length) * 100) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    .slice(0, 5);

  const updatedAt = workspace.dataUpdatedAt ? new Date(workspace.dataUpdatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : null;

  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(today);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-callout font-medium text-muted-foreground first-letter:uppercase">
            {dateLabel}
          </p>
          <h1 className="mt-1 text-title-1 sm:text-display">{greetingFor(today)}</h1>
          <p className="mt-2 text-body text-muted-foreground">
            Обзор задач проектов, доступных вам
          </p>
        </div>
        <div
          role="status"
          aria-live="polite"
          className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-caption text-muted-foreground"
        >
          <span aria-hidden className="relative flex h-2 w-2">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:hidden" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-primary" : realtime === "connecting" ? "bg-muted-foreground" : "bg-destructive"}`}
            />
          </span>
          <span className={live ? "font-semibold tracking-wider text-foreground" : ""}>
            {live ? "LIVE" : realtime === "connecting" ? "Подключение…" : "Нет связи"}
          </span>
          {updatedAt && <span className="hidden sm:inline">· обновлено {updatedAt}</span>}
        </div>
      </header>
      {workspace.error && (
        <p
          role="alert"
          className="mb-4 rounded-card border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground"
        >
          Не удалось загрузить данные: {(workspace.error as Error).message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <KpiCard
            key={kpi.label}
            kpi={kpi}
            loading={workspace.isLoading}
            icon={KPI_ICONS[index] ?? ListTodo}
          />
        ))}
      </div>

      {/* minmax(0,1fr) columns: a long task title truncates instead of widening the page. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="min-w-0 rounded-card border border-border bg-card p-2 sm:p-3 lg:col-span-2">
          <div className="flex items-center justify-between px-3 pb-2 pt-2">
            <h2 className="text-title-3">Последние задачи</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => go("tickets")}
              onPointerEnter={prefetchTaskWorkspace}
              onFocus={prefetchTaskWorkspace}
              className="rounded-full text-muted-foreground"
            >
              Все задачи
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {workspace.isLoading ? (
            <div className="space-y-1 px-1 pb-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-secondary/40 motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : recentTasks.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">
              Задач пока нет. Они появятся здесь, как только их создадут в проектах.
            </p>
          ) : (
            <div className="space-y-0.5">
              {recentTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  onPointerEnter={prefetchTaskWorkspace}
                  onFocus={prefetchTaskWorkspace}
                  className="group flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[background-color,scale] duration-200 ease-(--ease-spring) hover:bg-white/[0.04] active:scale-[0.99]"
                >
                  <span className="w-9 shrink-0 font-mono text-caption text-muted-foreground">
                    #{t.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium" title={t.title}>
                      {t.title}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                      {t.assignee_id ? <EmployeeName name={nameOf(t.assignee_id) ?? "Сотрудник"} isVip={isVipOf(t.assignee_id)} /> : "Без исполнителя"}
                      {runningTaskIds.has(t.id) && <span className="text-primary"> · таймер идёт</span>}
                    </span>
                  </span>
                  <span className="hidden shrink-0 font-mono text-caption tabular-nums text-muted-foreground sm:block">
                    {formatDuration(t.spent_seconds)}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-caption font-medium ${statusClass(t.status)}`}
                  >
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="hidden h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block"
                  />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="min-w-0 rounded-card border border-border bg-card p-5">
          <h2 className="text-title-3">Нагрузка команды</h2>
          <p className="mt-1 text-caption text-muted-foreground">Открытые задачи на сотрудника</p>
          <div className="mt-5 space-y-4">
            {workspace.isLoading ? (
              [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded-lg bg-secondary/40 motion-reduce:animate-none"
                />
              ))
            ) : teamLoad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет открытых задач с исполнителем.</p>
            ) : (
              teamLoad.map((a, index) => (
                <div key={a.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <EmployeeName
                      name={a.name}
                      isVip={isVipOf(a.id)}
                      title={a.name}
                      className="truncate text-callout"
                    />
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {a.count}
                      {a.inProgress ? ` · в работе ${a.inProgress}` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="luno-bar h-full rounded-full bg-gradient-to-r from-[#FF5A00] to-primary transition-[width] duration-500 motion-reduce:transition-none"
                      style={{ width: `${a.share}%`, animationDelay: `${200 + index * 70}ms` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Placeholder in the Tasks layout while the TaskWorkspace chunk loads. */
function TasksSkeleton() {
  return (
    <div role="status" aria-label="Загрузка задач" className="animate-pulse motion-reduce:animate-none">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-32 rounded-md bg-secondary/60" />
        <div className="h-4 w-56 rounded bg-secondary/40" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="hidden h-64 rounded-xl border border-border bg-card/40 lg:block" />
        <div className="space-y-2 rounded-xl border border-border bg-card/40 p-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary/40" />)}
        </div>
      </div>
    </div>
  );
}

function Tickets({
  initialMineOnly = false,
  initialTaskId = null,
}: {
  initialMineOnly?: boolean;
  initialTaskId?: string | null;
}) {
  return (
    <div>
      <Suspense fallback={<TasksSkeleton />}>
        <TaskWorkspace initialMineOnly={initialMineOnly} initialTaskId={initialTaskId} />
      </Suspense>
    </div>
  );
}

function EmployeeProfile({
  employee,
  onAvatarChanged,
  onOpenTasks,
}: {
  employee: EmployeeProfileData;
  onAvatarChanged: () => Promise<void>;
  onOpenTasks: () => void;
}) {
  const joinedAt = employee.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(employee.created_at))
    : null;
  const director =
    employee.role === "director" ||
    employee.position?.trim().toLocaleLowerCase("ru-RU") === "директор";
  const position = (director ? employee.position || "Директор" : employee.position) || null;
  // Live status from Realtime Presence (not profiles.presence, not is_active).
  const online = useIsOnline(employee.id);
  // Contacts list only fields that actually have a value the viewer may see.
  const email = realValue(employee.email);
  const phone = realPhone(employee.phone);
  const location = realValue(employee.location);
  const role = employee.role ? (ROLE_LABEL[employee.role] ?? employee.role) : null;

  // Same blocks as a card in the employee directory (profile-display.tsx).
  return (
    <div className="space-y-4">
      <ProfileHero
        heading="h1"
        avatar={
          <EditableProfileAvatar
            avatarUrl={employee.avatar_url}
            name={employee.full_name}
            initials={employee.initials}
            onUploaded={onAvatarChanged}
          />
        }
        name={employee.full_name}
        isVip={employee.is_vip}
        isDirector={director}
        subtitle={
          [position, employee.department].filter(Boolean).join(" · ") ||
          "Должность и отдел не указаны"
        }
        presence={<PresenceBadge online={online} />}
        actions={
          <Button className="rounded-full px-5" onClick={onOpenTasks}>
            <ListChecks />
            Мои задачи
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InfoGroup title="Контакты">
          <InfoRow
            icon={Mail}
            label="Почта"
            value={email ?? "Не указана"}
            muted={!email}
            action={email ? <CopyValueButton value={email} label="Скопировать почту" /> : undefined}
          />
          {employee.private_fields_allowed && (
            <InfoRow icon={Phone} label="Телефон" value={phone ?? "Не указан"} muted={!phone} />
          )}
          {employee.private_fields_allowed && (
            <InfoRow
              icon={MapPin}
              label="Локация"
              value={location ?? "Не указана"}
              muted={!location}
            />
          )}
        </InfoGroup>

        <InfoGroup title="Работа">
          <InfoRow
            icon={Briefcase}
            label="Должность"
            value={position ?? "Не указана"}
            muted={!position}
          />
          <InfoRow
            icon={Building2}
            label="Отдел"
            value={employee.department || "Не указан"}
            muted={!employee.department}
          />
          <InfoRow
            icon={CalendarDays}
            label="Профиль создан"
            value={joinedAt ?? "Не указана"}
            muted={!joinedAt}
          />
        </InfoGroup>
      </div>

      <FactTiles
        title="Доступ"
        items={[
          {
            label: "Уровень доступа",
            value:
              employee.access_level === null ? (
                "Не определён"
              ) : (
                <AccessLevelValue level={employee.access_level} />
              ),
            muted: employee.access_level === null,
          },
          { label: "Роль", value: role ?? "Не указана", muted: !role },
          { label: "Статус", value: <ActiveValue active={employee.is_active} /> },
          { label: "VIP", value: employee.is_vip ? "Да" : "Нет", muted: !employee.is_vip },
        ]}
      />
    </div>
  );
}
