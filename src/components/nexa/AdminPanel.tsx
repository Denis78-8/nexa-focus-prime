import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  Clock,
  Copy,
  Crown,
  Database,
  KeyRound,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  Tag,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { createEmployee, reissueTemporaryPassword as reissueTemporaryPasswordFor } from "@/lib/edge-functions";
import { useAmbientIntensity } from "@/components/nexa/AmbientFlowBackground";
import { PasswordInput } from "@/components/nexa/PasswordInput";
import {
  AccessLevelMeter,
  DirectorBadge,
  EmployeeName,
  ROLE_LABEL,
  VipBadge,
  initialsOf,
} from "@/components/nexa/profile-display";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ENTER } from "@/lib/motion";
import { getAdminData, getSystemStatus, reserveCorporateMailbox, suggestCorporateEmail, updateEmployee, updateEmployeePassword, updatePermissionMatrix } from "@/lib/admin.functions";

type Employee = { id: string; full_name: string; email: string | null; position: string | null; department: string | null; phone: string | null; location: string | null; access_level: number; is_vip: boolean; is_active: boolean; mailbox_status: string; invitation_status: string };
type AdminData = { employees: Employee[]; roles: { user_id: string; role: string }[]; permissions: { key: string; description: string }[]; rolePermissions: { role: string; permission_key: string }[]; levelPermissions: { access_level: number; permission_key: string }[]; owners: { user_id: string }[]; credentials: { user_id: string; must_change_password: boolean; expires_at: string; changed_at: string | null }[]; mailboxes: { id: string; user_id: string; email: string; local_part: string; domain: string; status: string; provider: string | null; is_primary: boolean; created_at: string }[]; credentialManagementAllowed: boolean; mailboxesAllowed: boolean; capabilities: { employeesManage: boolean; profilesWrite: boolean; rolesManage: boolean; accessLevelsManage: boolean; vipManage: boolean; systemManage: boolean; mailboxesRead: boolean; mailboxesManage: boolean } };
type Role = "employee" | "manager" | "director" | "admin";
type InviteRole = Exclude<Role, "admin">;
type EmployeeDraft = { role: Role; accessLevel: number; isVip: boolean; isActive: boolean; fullName: string; position: string; department: string; phone: string; location: string };

function roleForEmployee(userId: string, adminData: AdminData): Role {
  if (adminData.owners.some((owner) => owner.user_id === userId)) return "admin";
  const roles = adminData.roles.filter((row) => row.user_id === userId).map((row) => row.role);
  for (const role of ["director", "admin", "manager", "employee"] as const) {
    if (roles.includes(role)) return role;
  }
  return "employee";
}

function employeeDraftsFromCloud(adminData: AdminData): Record<string, EmployeeDraft> {
  return Object.fromEntries(adminData.employees.map((person) => [person.id, {
    role: roleForEmployee(person.id, adminData),
    accessLevel: person.access_level,
    isVip: person.is_vip,
    isActive: person.is_active,
    fullName: person.full_name,
    position: person.position ?? "",
    department: person.department ?? "",
    phone: person.phone ?? "",
    location: person.location ?? "",
  }]));
}

function isDirector(role: string | null | undefined, position: string | null | undefined) {
  return role === "director" || position?.trim().toLocaleLowerCase("ru-RU") === "директор";
}

function safeSaveError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Не удалось сохранить изменения сотрудника";
  return raw
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [скрыто]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[скрытый токен]")
    .slice(0, 500);
}

export function AdminPanel({ onEmployeeSaved }: { onEmployeeSaved?: (userId: string) => Promise<void> }) {
  useAmbientIntensity("calm");
  const load = useServerFn(getAdminData);
  const saveEmployee = useServerFn(updateEmployee);
  const setMatrix = useServerFn(updatePermissionMatrix);
  const loadStatus = useServerFn(getSystemStatus);
  const suggestEmail = useServerFn(suggestCorporateEmail);
  const reserveMailbox = useServerFn(reserveCorporateMailbox);
  const changeEmployeePassword = useServerFn(updateEmployeePassword);
  const [data, setData] = useState<AdminData | null>(null);
  const { session } = useAuth();
  const viewerIsOwner = Boolean(session && data?.owners.some((owner) => owner.user_id === session.user.id));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ database: string; checkedAt: string; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [passwordTargetId, setPasswordTargetId] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [drafts, setDrafts] = useState<Record<string, EmployeeDraft>>({});
  const [proposals, setProposals] = useState<Record<string, string>>({});
  const [formProposal, setFormProposal] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "", department: "", role: "employee" as InviteRole, accessLevel: 2, isVip: false });
  // One-time display of system-issued credentials. Held only in memory and
  // cleared when the dialog closes; never logged, toasted or persisted.
  const [issued, setIssued] = useState<{ title: string; fullName: string; login: string; temporaryPassword: string; expiresAt: string } | null>(null);
  // UI-only: which employee card is unfolded, whether the "new employee" form
  // is open, and whose temporary password waits for confirmation.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reissueTarget, setReissueTarget] = useState<Employee | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Сервер не ответил за 15 секунд. Проверьте соединение и повторите загрузку.")), 15_000);
      });
      const result = await Promise.race([load(), timeout]);
      setData(result);
      setDrafts(employeeDraftsFromCloud(result));
      if (result.capabilities.systemManage) {
        try { setStatus(await loadStatus()); } catch { setStatus(null); }
      } else {
        setStatus(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить данные Admin Panel";
      setLoadError(message);
      toast.error(message);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const fullName = form.fullName.trim();
    if (!data?.capabilities.mailboxesManage || fullName.length < 2) { setFormProposal(null); return; }
    const timer = window.setTimeout(() => {
      suggestEmail({ data: { fullName } }).then((result) => setFormProposal(result.email)).catch(() => setFormProposal(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [form.fullName, suggestEmail, data?.capabilities.mailboxesManage]);

  const toggleMatrix = async (kind: "role" | "level", subject: string, permission: string, enabled: boolean) => {
    setBusy(true);
    try {
      await setMatrix({ data: { kind, subject, permission, enabled } });
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const submitNewEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const fullName = form.fullName.trim();
      const result = await createEmployee({ ...form, position: form.position || undefined, department: form.department || undefined });
      setIssued({ title: "Сотрудник создан", fullName, ...result });
      setForm({ fullName: "", position: "", department: "", role: "employee", accessLevel: 2, isVip: false });
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  // Asked for in a branded AlertDialog (reissueTarget below) instead of window.confirm.
  const reissueTemporaryPassword = async (person: Employee) => {
    setBusy(true);
    try {
      const result = await reissueTemporaryPasswordFor(person.id);
      setIssued({ title: "Новый временный пароль", fullName: person.full_name, ...result });
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const createMailboxReservation = async (userId: string, email: string) => {
    setBusy(true);
    try {
      const result = await reserveMailbox({ data: { userId, email } });
      setProposals((current) => { const next = { ...current }; delete next[userId]; return next; });
      if (result.provisioning === "provider_not_configured") {
        toast.message(`Адрес ${result.mailbox.email} зарезервирован в LUNO DIGITAL. Реальный почтовый ящик не создан: провайдер не подключён.`);
      } else if (result.provisioning === "provider_error") {
        toast.error(`Адрес ${result.mailbox.email} зарезервирован, но внешний провайдер вернул ошибку. Ящик не активирован.`);
      } else {
        toast.success(`Провайдер подтвердил создание ${result.mailbox.email}`);
      }
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const proposeForEmployee = async (person: Employee) => {
    setBusy(true);
    try {
      const proposal = await suggestEmail({ data: { fullName: person.full_name, userId: person.id } });
      setProposals((current) => ({ ...current, [person.id]: proposal.email }));
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const save = async (person: Employee) => {
    const draft = drafts[person.id];
    if (!draft) return;
    if (import.meta.env.DEV) {
      console.info("[NEXA Admin phone/location DEV] before Save", {
        userId: person.id,
        phone: draft.phone,
        location: draft.location,
      });
    }
    const expected = {
      fullName: draft.fullName.trim(),
      position: draft.position.trim() || null,
      department: draft.department.trim() || null,
      phone: draft.phone.trim() || null,
      location: draft.location.trim() || null,
      accessLevel: draft.accessLevel,
      role: draft.role,
      isVip: draft.isVip,
      isActive: draft.isActive,
    };
    setSavingEmployeeId(person.id);
    try {
      await saveEmployee({ data: { id: person.id, fullName: expected.fullName, position: expected.position, department: expected.department, phone: expected.phone, location: expected.location, role: expected.role, accessLevel: expected.accessLevel, isVip: expected.isVip, isActive: expected.isActive } });
      const reread = await load();
      setData(reread);
      setDrafts(employeeDraftsFromCloud(reread));
      const savedEmployee = reread.employees.find((row) => row.id === person.id);
      if (import.meta.env.DEV) {
        console.info("[NEXA Admin phone/location DEV] Cloud reread", {
          userId: person.id,
          phone: savedEmployee?.phone ?? null,
          location: savedEmployee?.location ?? null,
        });
      }
      const matchesCloud = savedEmployee
        && savedEmployee.full_name === expected.fullName
        && savedEmployee.position === expected.position
        && savedEmployee.department === expected.department
        && savedEmployee.phone === expected.phone
        && savedEmployee.location === expected.location
        && savedEmployee.access_level === expected.accessLevel
        && savedEmployee.is_vip === expected.isVip
        && savedEmployee.is_active === expected.isActive
        && roleForEmployee(person.id, reread) === expected.role;
      if (!matchesCloud) throw new Error("Повторное чтение Cloud не подтвердило сохранённые значения. На экране показано фактическое состояние из БД.");
      await onEmployeeSaved?.(person.id);
      toast.success("Сохранено");
    } catch (error) {
      toast.error(safeSaveError(error));
    } finally {
      setSavingEmployeeId(null);
    }
  };

  const submitPasswordChange = async (event: React.FormEvent, person: Employee) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    setPasswordBusy(true);
    try {
      await changeEmployeePassword({ data: { userId: person.id, ...passwordForm } });
      setPasswordTargetId(null);
      setPasswordForm({ newPassword: "", confirmPassword: "" });
      toast.success("Пароль изменён");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const rolePermissions = useMemo(() => new Set(data?.rolePermissions.map((r: { role: string; permission_key: string }) => `${r.role}:${r.permission_key}`)), [data]);
  const levelPermissions = useMemo(() => new Set(data?.levelPermissions.map((r: { access_level: number; permission_key: string }) => `${r.access_level}:${r.permission_key}`)), [data]);
  // Saved values, to mark folded cards that hold unsaved edits.
  const cloudDrafts = useMemo(() => (data ? employeeDraftsFromCloud(data) : {}), [data]);
  const patchDraft = (id: string, patch: Partial<EmployeeDraft>) => setDrafts((prev) => {
    const current = prev[id];
    return current ? { ...prev, [id]: { ...current, ...patch } } : prev;
  });

  if (!data)
    return (
      <div role={loadError ? "alert" : "status"}>
        <h1 className="text-title-1">Администрирование LUNO DIGITAL</h1>
        {loadError ? (
          <div className="mt-6 rounded-card border border-destructive/30 bg-destructive/10 p-5">
            <p className="text-body font-medium">Не удалось загрузить панель администратора</p>
            <p className="mt-2 break-words text-callout text-muted-foreground">{loadError}</p>
            <Button
              className="mt-4 rounded-full"
              variant="outline"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "Повторная загрузка…" : "Повторить"}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            <span className="sr-only">Загрузка панели администратора…</span>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-card border border-border bg-card"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    );

  const ownerIds = new Set(data.owners.map((owner) => owner.user_id));
  const canSave =
    data.capabilities.profilesWrite ||
    data.capabilities.employeesManage ||
    data.capabilities.rolesManage ||
    data.capabilities.accessLevelsManage ||
    data.capabilities.vipManage;
  const activeCount = data.employees.filter((person) => person.is_active).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title-1">Администрирование LUNO DIGITAL</h1>
          <p className="mt-2 text-body text-muted-foreground">
            Сотрудники, доступ и состояние системы. Каждое изменение проверяется сервером.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full px-3.5"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Обновить
          </Button>
          {data.capabilities.employeesManage && (
            <Button
              size="sm"
              className="h-9 rounded-full px-4"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen((open) => !open)}
            >
              <Plus
                className={`transition-[rotate] duration-300 ease-(--ease-spring) ${createOpen ? "rotate-45" : ""}`}
              />
              Новый сотрудник
            </Button>
          )}
        </div>
      </header>

      {data.capabilities.systemManage && (
        <section aria-label="Состояние системы">
          {status ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              <StatusTile icon={Database} label="База данных">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${status.database === "ok" ? "bg-success shadow-[0_0_8px_oklch(0.75_0.15_150/0.6)]" : "bg-destructive"}`}
                  />
                  <span className={status.database === "ok" ? "" : "text-destructive"}>
                    {status.database === "ok" ? "Работает" : status.database}
                  </span>
                </span>
              </StatusTile>
              <StatusTile icon={Tag} label="Версия">
                {status.version}
              </StatusTile>
              <StatusTile icon={Clock} label="Проверено">
                {new Date(status.checkedAt).toLocaleString("ru-RU")}
              </StatusTile>
            </dl>
          ) : (
            <p className="rounded-card border border-border bg-card px-5 py-4 text-callout text-muted-foreground">
              Состояние системы: нет доступа к мониторингу или отсутствует серверный ключ.
            </p>
          )}
        </section>
      )}

      <AnimatePresence initial={false}>
        {data.capabilities.employeesManage && createOpen && (
          <motion.section
            key="create"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={ENTER}
            className="overflow-hidden"
          >
            <div className="rounded-card border border-border bg-card p-5 sm:p-6">
              <h2 className="text-title-3">Новый сотрудник</h2>
              <form onSubmit={submitNewEmployee} className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Имя и фамилия" htmlFor="admin-new-name">
                    <Input
                      id="admin-new-name"
                      required
                      placeholder="Иван Петров"
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    />
                  </Field>
                  <Field label="Должность" htmlFor="admin-new-position">
                    <Input
                      id="admin-new-position"
                      placeholder="Не обязательно"
                      value={form.position}
                      onChange={(e) => setForm({ ...form, position: e.target.value })}
                    />
                  </Field>
                  <Field label="Отдел" htmlFor="admin-new-department">
                    <Input
                      id="admin-new-department"
                      placeholder="Не обязательно"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                    />
                  </Field>
                  <Field label="Роль" htmlFor="admin-new-role">
                    <NativeSelect
                      id="admin-new-role"
                      disabled={!data.capabilities.rolesManage}
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value as InviteRole })}
                    >
                      <option value="employee">Сотрудник</option>
                      <option value="manager">Менеджер</option>
                      <option value="director">Директор</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Уровень доступа" htmlFor="admin-new-level">
                    <NativeSelect
                      id="admin-new-level"
                      disabled={!data.capabilities.accessLevelsManage || !viewerIsOwner}
                      value={form.accessLevel}
                      onChange={(e) => setForm({ ...form, accessLevel: Number(e.target.value) })}
                    >
                      {[1, 2, 3, 4, 5].map((level) => (
                        <option key={level} value={level}>
                          Уровень {level}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <SwitchField
                    id="admin-new-vip"
                    label="VIP"
                    checked={form.isVip}
                    disabled={!data.capabilities.vipManage}
                    onChange={(value) => setForm({ ...form, isVip: value })}
                  />
                </div>
                <div className="flex gap-3 rounded-xl border border-border bg-background/50 p-3.5">
                  <Mail aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 text-callout">
                    <span className="text-muted-foreground">
                      Логин будет сформирован системой:{" "}
                    </span>
                    <span className="font-medium [overflow-wrap:anywhere]">
                      {formProposal ||
                        (form.fullName.trim().length < 2
                          ? "введите имя и фамилию"
                          : "по корпоративному шаблону")}
                    </span>
                    <p className="mt-1 text-caption text-muted-foreground">
                      Временный пароль генерируется системой, показывается один раз и действует 72
                      часа. При первом входе сотрудник обязан сменить пароль.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                    Отмена
                  </Button>
                  <Button disabled={busy} className="rounded-full px-5">
                    <UserPlus />
                    Создать сотрудника
                  </Button>
                </div>
              </form>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <Dialog
        open={issued !== null}
        onOpenChange={(open) => {
          if (!open) setIssued(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{issued?.title}</DialogTitle>
            <DialogDescription>
              {issued?.fullName}. Пароль показывается только сейчас — после закрытия окна его нельзя
              будет посмотреть снова.
            </DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="space-y-3">
              <div className="divide-y divide-border rounded-xl border border-border bg-background/50">
                <div className="px-3.5 py-2.5">
                  <div className="text-caption text-muted-foreground">Логин</div>
                  <div className="mt-0.5 break-all font-mono text-body">{issued.login}</div>
                </div>
                <div className="px-3.5 py-2.5">
                  <div className="text-caption text-muted-foreground">Временный пароль</div>
                  <div className="mt-0.5 break-all font-mono text-body">
                    {issued.temporaryPassword}
                  </div>
                </div>
                <div className="px-3.5 py-2.5">
                  <div className="text-caption text-muted-foreground">Действителен</div>
                  <div className="mt-0.5 text-body">
                    72 часа · до {new Date(issued.expiresAt).toLocaleString("ru-RU")}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => void copyToClipboard(issued.login, "Логин")}
                >
                  <Copy />
                  Скопировать логин
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => void copyToClipboard(issued.temporaryPassword, "Пароль")}
                >
                  <Copy />
                  Скопировать пароль
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto rounded-full px-4"
                  onClick={() => setIssued(null)}
                >
                  Готово
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={reissueTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReissueTarget(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[26rem] gap-5 p-6">
          <AlertDialogHeader className="space-y-2.5">
            <span
              aria-hidden
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-primary/25 bg-primary-soft text-primary sm:mx-0"
            >
              <KeyRound className="h-5 w-5" />
            </span>
            <AlertDialogTitle>Новый временный пароль</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-muted-foreground">
              Сгенерировать новый временный пароль для {reissueTarget?.full_name}? Текущий пароль
              сотрудника перестанет действовать.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = reissueTarget;
                setReissueTarget(null);
                if (target) void reissueTemporaryPassword(target);
              }}
            >
              Сгенерировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="flex items-baseline gap-2 text-title-3">
            Сотрудники
            <span className="text-body font-normal tabular-nums text-muted-foreground">
              {data.employees.length}
            </span>
          </h2>
          <span className="text-callout text-muted-foreground">
            Активных: <span className="tabular-nums text-foreground-secondary">{activeCount}</span>{" "}
            · нажмите на строку, чтобы изменить
          </span>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
          {data.employees.map((person: Employee) => {
            const draft = drafts[person.id];
            if (!draft) return null;
            const isOwnerRow = ownerIds.has(person.id);
            const expanded = expandedId === person.id;
            const saved = cloudDrafts[person.id];
            const dirty = saved
              ? (Object.keys(draft) as (keyof EmployeeDraft)[]).some(
                  (key) => draft[key] !== saved[key],
                )
              : false;
            const credential = data.credentials.find((row) => row.user_id === person.id);
            const pending = credential?.must_change_password ?? false;
            const expired = pending && new Date(credential!.expires_at).getTime() <= Date.now();
            const canReissue = viewerIsOwner && !isOwnerRow && person.is_active;
            const panelId = `admin-employee-${person.id}`;
            const name = draft.fullName || person.full_name;
            return (
              <article key={person.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setExpandedId(expanded ? null : person.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-200 sm:px-5 ${expanded ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"}`}
                >
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-callout font-semibold text-foreground-secondary"
                  >
                    {initialsOf(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <EmployeeName
                        name={name}
                        isVip={draft.isVip}
                        className="min-w-0 text-body font-medium"
                      />
                      {draft.isVip && <VipBadge size="sm" />}
                      {isDirector(draft.role, draft.position) && <DirectorBadge size="sm" />}
                      {isOwnerRow && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-medium text-primary">
                          <Crown className="h-3 w-3" />
                          Владелец
                        </span>
                      )}
                      {dirty && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-1.5 py-px text-[10px] font-medium text-warning">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                          Не сохранено
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                      {person.email ?? "Почта не указана"} · {person.department || "Без отдела"}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-5 text-callout text-foreground-secondary md:flex">
                    <span className="w-28 truncate text-right">
                      {ROLE_LABEL[draft.role] ?? draft.role}
                    </span>
                    <span
                      className="flex w-20 items-center justify-end gap-2"
                      title={`Уровень доступа ${draft.accessLevel}`}
                    >
                      <span className="tabular-nums">Ур. {draft.accessLevel}</span>
                      <AccessLevelMeter level={draft.accessLevel} size="sm" />
                    </span>
                    <span className="flex w-24 items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${draft.isActive ? "bg-success" : "bg-destructive"}`}
                      />
                      {draft.isActive ? "Активен" : "Неактивен"}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-[rotate] duration-300 ease-(--ease-spring) ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      id={panelId}
                      key="panel"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={ENTER}
                      className="overflow-hidden"
                    >
                      <div className="space-y-6 border-t border-border bg-background/30 px-4 py-5 sm:px-5">
                        <p className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
                          Почта для входа: {person.email ?? "не указана"} · Приглашение:{" "}
                          {INVITATION_LABEL[person.invitation_status] ?? person.invitation_status}
                        </p>

                        <div>
                          <h3 className="mb-2.5 text-callout font-semibold text-foreground-secondary">
                            Профиль
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label="Имя" htmlFor={`${panelId}-name`}>
                              <Input
                                id={`${panelId}-name`}
                                disabled={!data.capabilities.profilesWrite}
                                value={draft.fullName}
                                onChange={(e) =>
                                  patchDraft(person.id, { fullName: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Должность" htmlFor={`${panelId}-position`}>
                              <Input
                                id={`${panelId}-position`}
                                disabled={!data.capabilities.profilesWrite}
                                placeholder="Должность"
                                value={draft.position}
                                onChange={(e) =>
                                  patchDraft(person.id, { position: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Отдел" htmlFor={`${panelId}-department`}>
                              <Input
                                id={`${panelId}-department`}
                                disabled={!data.capabilities.profilesWrite}
                                placeholder="Отдел"
                                value={draft.department}
                                onChange={(e) =>
                                  patchDraft(person.id, { department: e.target.value })
                                }
                              />
                            </Field>
                            <Field label="Телефон" htmlFor={`${panelId}-phone`}>
                              <Input
                                id={`${panelId}-phone`}
                                disabled={!data.capabilities.profilesWrite}
                                placeholder="Телефон"
                                value={draft.phone}
                                onChange={(e) => patchDraft(person.id, { phone: e.target.value })}
                              />
                            </Field>
                            <Field label="Локация" htmlFor={`${panelId}-location`}>
                              <Input
                                id={`${panelId}-location`}
                                disabled={!data.capabilities.profilesWrite}
                                placeholder="Локация"
                                value={draft.location}
                                onChange={(e) =>
                                  patchDraft(person.id, { location: e.target.value })
                                }
                              />
                            </Field>
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-2.5 text-callout font-semibold text-foreground-secondary">
                            Доступ
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Field label="Роль" htmlFor={`${panelId}-role`}>
                              <div
                                className="flex items-center gap-2"
                                title={
                                  isOwnerRow
                                    ? "Роль владельца LUNO DIGITAL нельзя изменить"
                                    : undefined
                                }
                              >
                                <NativeSelect
                                  id={`${panelId}-role`}
                                  wrapperClassName="flex-1"
                                  disabled={!data.capabilities.rolesManage || isOwnerRow}
                                  value={draft.role}
                                  onChange={(e) =>
                                    patchDraft(person.id, { role: e.target.value as Role })
                                  }
                                >
                                  <option value="employee">Сотрудник</option>
                                  <option value="manager">Менеджер</option>
                                  <option value="director">Директор</option>
                                  <option value="admin">Администратор</option>
                                </NativeSelect>
                                {isOwnerRow && (
                                  <span
                                    aria-label="Роль владельца LUNO DIGITAL нельзя изменить"
                                    className="text-muted-foreground"
                                  >
                                    <LockKeyhole className="h-4 w-4" />
                                  </span>
                                )}
                              </div>
                            </Field>
                            <Field label="Уровень доступа" htmlFor={`${panelId}-level`}>
                              <NativeSelect
                                id={`${panelId}-level`}
                                disabled={!data.capabilities.accessLevelsManage || !viewerIsOwner}
                                value={draft.accessLevel}
                                onChange={(e) =>
                                  patchDraft(person.id, { accessLevel: Number(e.target.value) })
                                }
                              >
                                {[1, 2, 3, 4, 5].map((level) => (
                                  <option key={level} value={level}>
                                    Уровень {level}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                            <SwitchField
                              id={`${panelId}-active`}
                              label="Активен"
                              checked={draft.isActive}
                              disabled={!data.capabilities.employeesManage}
                              onChange={(value) => patchDraft(person.id, { isActive: value })}
                            />
                            <SwitchField
                              id={`${panelId}-vip`}
                              label="VIP"
                              checked={draft.isVip}
                              disabled={!data.capabilities.vipManage}
                              onChange={(value) => patchDraft(person.id, { isVip: value })}
                            />
                          </div>
                        </div>

                        {canSave && (
                          <div className="flex flex-wrap items-center justify-end gap-3">
                            {dirty && (
                              <span className="text-callout text-warning">
                                Есть несохранённые изменения
                              </span>
                            )}
                            <Button
                              className="rounded-full px-5"
                              disabled={busy || savingEmployeeId !== null}
                              onClick={() => void save(person)}
                            >
                              {savingEmployeeId === person.id ? "Сохраняем…" : "Сохранить"}
                            </Button>
                          </div>
                        )}

                        {(pending || canReissue || data.credentialManagementAllowed) && (
                          <div className="border-t border-border pt-5">
                            <h3 className="mb-2.5 text-callout font-semibold text-foreground-secondary">
                              Вход и пароль
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                              {pending && (
                                <span
                                  className={`rounded-full px-2.5 py-1 text-caption ${expired ? "bg-destructive/15 text-destructive" : "bg-primary-soft text-primary"}`}
                                >
                                  {expired
                                    ? "Временный пароль истёк"
                                    : `Ожидает смены временного пароля · до ${new Date(credential!.expires_at).toLocaleString("ru-RU")}`}
                                </span>
                              )}
                              {canReissue && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="rounded-full"
                                  disabled={busy}
                                  onClick={() => setReissueTarget(person)}
                                >
                                  <KeyRound />
                                  Сгенерировать новый временный пароль
                                </Button>
                              )}
                              {data.credentialManagementAllowed &&
                                passwordTargetId !== person.id && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full"
                                    disabled={busy || passwordBusy || !person.is_active}
                                    onClick={() => {
                                      setPasswordForm({ newPassword: "", confirmPassword: "" });
                                      setPasswordTargetId(person.id);
                                    }}
                                  >
                                    Изменить пароль
                                  </Button>
                                )}
                            </div>
                            {data.credentialManagementAllowed && passwordTargetId === person.id && (
                              <form
                                onSubmit={(event) => void submitPasswordChange(event, person)}
                                className="mt-3 grid gap-2 rounded-xl border border-border bg-background/50 p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center"
                              >
                                <PasswordInput
                                  id={`${panelId}-new-password`}
                                  aria-label="Новый пароль"
                                  autoComplete="new-password"
                                  minLength={12}
                                  maxLength={128}
                                  required
                                  value={passwordForm.newPassword}
                                  onChange={(e) =>
                                    setPasswordForm((current) => ({
                                      ...current,
                                      newPassword: e.target.value,
                                    }))
                                  }
                                  placeholder="Новый пароль (от 12 символов)"
                                />
                                <PasswordInput
                                  id={`${panelId}-confirm-password`}
                                  aria-label="Подтверждение пароля"
                                  autoComplete="new-password"
                                  minLength={12}
                                  maxLength={128}
                                  required
                                  value={passwordForm.confirmPassword}
                                  onChange={(e) =>
                                    setPasswordForm((current) => ({
                                      ...current,
                                      confirmPassword: e.target.value,
                                    }))
                                  }
                                  placeholder="Подтверждение пароля"
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  className="rounded-full"
                                  disabled={passwordBusy}
                                >
                                  {passwordBusy ? "Сохраняем…" : "Сохранить новый пароль"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={passwordBusy}
                                  onClick={() => {
                                    setPasswordTargetId(null);
                                    setPasswordForm({ newPassword: "", confirmPassword: "" });
                                  }}
                                >
                                  Отмена
                                </Button>
                              </form>
                            )}
                          </div>
                        )}

                        {data.mailboxesAllowed && (
                          <div className="border-t border-border pt-5">
                            <h3 className="mb-2.5 text-callout font-semibold text-foreground-secondary">
                              Корпоративная почта
                            </h3>
                            {(() => {
                              const mailbox = data.mailboxes.find(
                                (row) => row.user_id === person.id && row.is_primary,
                              );
                              const proposedEmail = proposals[person.id];
                              const statusLabel: Record<string, string> = {
                                pending: "Не подключена",
                                active: "Активна",
                                suspended: "Приостановлена",
                                disabled: "Отключена",
                                error: "Ошибка",
                              };
                              return mailbox ? (
                                <div className="rounded-xl border border-border bg-background/50 p-3.5">
                                  <div className="text-body font-medium [overflow-wrap:anywhere]">
                                    {mailbox.email}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
                                    <span>
                                      Статус: {statusLabel[mailbox.status] ?? mailbox.status}
                                    </span>
                                    <span>Провайдер: {mailbox.provider ?? "Не настроен"}</span>
                                    <span>
                                      Создана запись:{" "}
                                      {new Date(mailbox.created_at).toLocaleDateString("ru-RU")}
                                    </span>
                                  </div>
                                  {mailbox.status === "pending" && (
                                    <p className="mt-1.5 text-caption text-muted-foreground">
                                      Провайдер не подключён; настоящий ящик не создан.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="rounded-xl border border-border bg-background/50 p-3.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-body">
                                      Предлагаемый адрес:{" "}
                                      <strong className="font-medium [overflow-wrap:anywhere]">
                                        {proposedEmail ?? "ещё не сформирован"}
                                      </strong>
                                    </span>
                                    {!proposedEmail && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="rounded-full"
                                        disabled={busy}
                                        onClick={() => void proposeForEmployee(person)}
                                      >
                                        Предложить адрес
                                      </Button>
                                    )}
                                    {proposedEmail && (
                                      <Button
                                        size="sm"
                                        className="rounded-full"
                                        disabled={busy}
                                        onClick={() =>
                                          void createMailboxReservation(person.id, proposedEmail)
                                        }
                                      >
                                        Создать корпоративную почту
                                      </Button>
                                    )}
                                  </div>
                                  <p className="mt-1.5 text-caption text-muted-foreground">
                                    Провайдер не настроен. Подтверждение адреса зарезервирует его в
                                    LUNO DIGITAL, но не создаст внешний почтовый ящик.
                                  </p>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </article>
            );
          })}
        </div>
      </section>

      {(data.capabilities.rolesManage || data.capabilities.accessLevelsManage) && (
        <section>
          <div className="mb-3 px-1">
            <h2 className="text-title-3">Матрица ролей и разрешений</h2>
            <p className="mt-1 text-callout text-muted-foreground">
              Роль и числовой уровень доступа действуют независимо; критические административные
              права защищены реестром владельцев.
            </p>
          </div>
          <div className="max-h-[70vh] overflow-auto rounded-card border border-border bg-card">
            <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 border-b border-border bg-card px-4 py-3 text-callout font-semibold text-foreground-secondary">
                    Разрешение
                  </th>
                  {MATRIX_ROLES.map((role) => (
                    <th
                      key={role}
                      className="sticky top-0 z-10 border-b border-border bg-card px-2 py-3 text-center text-callout font-semibold text-foreground-secondary"
                    >
                      {ROLE_LABEL[role]}
                    </th>
                  ))}
                  {MATRIX_LEVELS.map((level) => (
                    <th
                      key={level}
                      className={`sticky top-0 z-10 border-b border-border bg-card px-2 py-3 text-center text-callout font-semibold text-foreground-secondary ${level === 1 ? "border-l" : ""}`}
                    >
                      Ур. {level}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((permission: { key: string; description: string }) => (
                  <tr key={permission.key} className="group">
                    <td className="sticky left-0 z-10 max-w-[22rem] border-b border-border bg-card px-4 py-3 transition-colors group-hover:bg-popover">
                      <div className="text-body text-foreground">{permission.description}</div>
                      <div className="mt-0.5 font-mono text-caption text-muted-foreground">
                        {permission.key}
                      </div>
                    </td>
                    {MATRIX_ROLES.map((role) => (
                      <td
                        key={role}
                        className="border-b border-border px-2 py-3 transition-colors group-hover:bg-popover"
                      >
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={`${ROLE_LABEL[role]}: ${permission.description}`}
                            checked={rolePermissions.has(`${role}:${permission.key}`)}
                            disabled={busy || !data.capabilities.rolesManage}
                            onCheckedChange={(value) =>
                              void toggleMatrix("role", role, permission.key, value === true)
                            }
                          />
                        </div>
                      </td>
                    ))}
                    {MATRIX_LEVELS.map((level) => (
                      <td
                        key={level}
                        className={`border-b border-border px-2 py-3 transition-colors group-hover:bg-popover ${level === 1 ? "border-l" : ""}`}
                      >
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={`Уровень ${level}: ${permission.description}`}
                            checked={levelPermissions.has(`${level}:${permission.key}`)}
                            disabled={busy || !data.capabilities.accessLevelsManage}
                            onCheckedChange={(value) =>
                              void toggleMatrix(
                                "level",
                                String(level),
                                permission.key,
                                value === true,
                              )
                            }
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const MATRIX_ROLES = ["employee", "manager", "director"] as const;
const MATRIX_LEVELS = [1, 2, 3, 4, 5] as const;

// profiles.invitation_status values written by the edge functions.
const INVITATION_LABEL: Record<string, string> = {
  not_invited: "не отправлено",
  sent: "отправлено",
  accepted: "принято, сотрудник вошёл",
  failed: "ошибка отправки",
};

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor} className="text-caption font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** A switch laid out like a field (label above, control in a field-height box). */
function SwitchField({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span aria-hidden className="block text-caption font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-input bg-field px-3">
        <label
          htmlFor={id}
          className={`text-body ${disabled ? "text-muted-foreground" : "cursor-pointer"}`}
        >
          {checked ? "Да" : "Нет"}
        </label>
        <Switch
          id={id}
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-card px-4 py-3.5">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/70 text-foreground-secondary"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-caption text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 truncate text-body">{children}</dd>
      </div>
    </div>
  );
}
