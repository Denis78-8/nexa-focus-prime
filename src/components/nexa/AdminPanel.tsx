import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { createEmployee, reissueTemporaryPassword as reissueTemporaryPasswordFor } from "@/lib/edge-functions";
import { useAmbientIntensity } from "@/components/nexa/AmbientFlowBackground";
import { EmployeeName } from "@/components/nexa/profile-display";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const reissueTemporaryPassword = async (person: Employee) => {
    if (!window.confirm(`Сгенерировать новый временный пароль для ${person.full_name}? Текущий пароль сотрудника перестанет действовать.`)) return;
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
  const patchDraft = (id: string, patch: Partial<EmployeeDraft>) => setDrafts((prev) => {
    const current = prev[id];
    return current ? { ...prev, [id]: { ...current, ...patch } } : prev;
  });

  if (!data) return <div className="rounded-lg border border-border bg-card p-6" role={loadError ? "alert" : "status"}>
    {loadError ? <>
      <p className="text-sm font-medium">Не удалось загрузить панель администратора</p>
      <p className="mt-2 break-words text-sm text-muted-foreground">{loadError}</p>
      <Button className="mt-4" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? "Повторная загрузка…" : "Повторить"}</Button>
    </> : <p className="text-sm text-muted-foreground">Загрузка панели администратора…</p>}
  </div>;

  return <div className="space-y-8">
    <header>
      <h1 className="text-xl font-semibold">Администрирование LUNO DIGITAL</h1>
      <p className="mt-1 text-sm text-muted-foreground">Сотрудники, доступ и состояние системы. Каждое изменение проверяется сервером.</p>
    </header>

    {data.capabilities.employeesManage && <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Создать сотрудника</h2>
      <form onSubmit={submitNewEmployee} className="mt-4 grid gap-3 md:grid-cols-3">
        <Input required placeholder="Имя и фамилия" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <Input placeholder="Должность" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        <Input placeholder="Отдел" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <select disabled={!data.capabilities.rolesManage} className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as InviteRole })}>
          <option value="employee">Сотрудник</option><option value="manager">Менеджер</option><option value="director">Директор</option>
        </select>
        <select disabled={!data.capabilities.accessLevelsManage || !viewerIsOwner} className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.accessLevel} onChange={(e) => setForm({ ...form, accessLevel: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Уровень {level}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!data.capabilities.vipManage} checked={form.isVip} onChange={(e) => setForm({ ...form, isVip: e.target.checked })} /> VIP</label>
        <Button disabled={busy} className="md:col-span-3">Создать сотрудника</Button>
      </form>
      <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
        <span className="text-muted-foreground">Логин будет сформирован системой: </span>
        <span className="font-medium">{formProposal || (form.fullName.trim().length < 2 ? "введите имя и фамилию" : "по корпоративному шаблону")}</span>
        <p className="mt-1 text-xs text-muted-foreground">Временный пароль генерируется системой, показывается один раз и действует 72 часа. При первом входе сотрудник обязан сменить пароль.</p>
      </div>
    </section>}

    <Dialog open={issued !== null} onOpenChange={(open) => { if (!open) setIssued(null); }}>
      <DialogContent className="dark border-border bg-card text-foreground sm:max-w-md" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{issued?.title}</DialogTitle>
          <DialogDescription>{issued?.fullName}. Пароль показывается только сейчас — после закрытия окна его нельзя будет посмотреть снова.</DialogDescription>
        </DialogHeader>
        {issued && <div className="space-y-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Логин</div><div className="break-all font-mono">{issued.login}</div></div>
          <div><div className="text-xs text-muted-foreground">Временный пароль</div><div className="break-all font-mono">{issued.temporaryPassword}</div></div>
          <div><div className="text-xs text-muted-foreground">Действителен</div><div>72 часа · до {new Date(issued.expiresAt).toLocaleString("ru-RU")}</div></div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyToClipboard(issued.login, "Логин")}>Скопировать логин</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyToClipboard(issued.temporaryPassword, "Пароль")}>Скопировать пароль</Button>
            <Button type="button" size="sm" className="ml-auto" onClick={() => setIssued(null)}>Готово</Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>

    <section>
      <div className="mb-3 flex items-baseline justify-between"><h2 className="text-sm font-semibold">Сотрудники · {data.employees.length}</h2><Button variant="outline" size="sm" onClick={() => void refresh()}>Обновить</Button></div>
      <div className="space-y-3">
        {data.employees.map((person: Employee) => {
          const draft = drafts[person.id];
          if (!draft) return null;
          return <article key={person.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-medium"><EmployeeName name={draft.fullName || person.full_name} isVip={draft.isVip} />{isDirector(draft.role, draft.position) && <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Директор</span>}{draft.isVip && (data.capabilities.vipManage ? <button type="button" aria-label="Отключить VIP" aria-pressed="true" onClick={() => patchDraft(person.id, { isVip: false })} className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.16)]">✦ VIP</button> : <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.16)]">✦ VIP</span>)}{!draft.isVip && data.capabilities.vipManage && <button type="button" aria-label="Включить VIP" aria-pressed="false" onClick={() => patchDraft(person.id, { isVip: true })} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">+ VIP</button>}{data.owners.some((owner) => owner.user_id === person.id) && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">Владелец</span>}</div><div className="mt-1 text-xs text-muted-foreground">Auth: {person.email} · {person.department || "Без отдела"} · Приглашение: {person.invitation_status}</div></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1" title={data.owners.some((owner) => owner.user_id === person.id) ? "Роль владельца LUNO DIGITAL нельзя изменить" : undefined}>
                  <select aria-label="Роль" disabled={!data.capabilities.rolesManage || data.owners.some((owner) => owner.user_id === person.id)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={draft.role} onChange={(e) => patchDraft(person.id, { role: e.target.value as Role })}><option value="employee">Сотрудник</option><option value="manager">Менеджер</option><option value="director">Директор</option><option value="admin">Администратор</option></select>
                  {data.owners.some((owner) => owner.user_id === person.id) && <span aria-label="Роль владельца LUNO DIGITAL нельзя изменить" className="text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" /></span>}
                </span>
                <select aria-label="Уровень доступа" disabled={!data.capabilities.accessLevelsManage || !viewerIsOwner} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={draft.accessLevel} onChange={(e) => patchDraft(person.id, { accessLevel: Number(e.target.value) })}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Уровень {level}</option>)}</select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!data.capabilities.employeesManage} checked={draft.isActive} onChange={(e) => patchDraft(person.id, { isActive: e.target.checked })} /> Активен</label>
                {(data.capabilities.profilesWrite || data.capabilities.employeesManage || data.capabilities.rolesManage || data.capabilities.accessLevelsManage || data.capabilities.vipManage) && <Button size="sm" disabled={busy || savingEmployeeId !== null} onClick={() => void save(person)}>{savingEmployeeId === person.id ? "Сохраняем…" : "Сохранить"}</Button>}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input aria-label="Имя сотрудника" disabled={!data.capabilities.profilesWrite} value={draft.fullName} onChange={(e) => patchDraft(person.id, { fullName: e.target.value })} />
              <Input aria-label="Должность" disabled={!data.capabilities.profilesWrite} placeholder="Должность" value={draft.position} onChange={(e) => patchDraft(person.id, { position: e.target.value })} />
              <Input aria-label="Отдел" disabled={!data.capabilities.profilesWrite} placeholder="Отдел" value={draft.department} onChange={(e) => patchDraft(person.id, { department: e.target.value })} />
              <Input aria-label="Телефон" disabled={!data.capabilities.profilesWrite} placeholder="Телефон" value={draft.phone} onChange={(e) => patchDraft(person.id, { phone: e.target.value })} />
              <Input aria-label="Локация" disabled={!data.capabilities.profilesWrite} placeholder="Локация" value={draft.location} onChange={(e) => patchDraft(person.id, { location: e.target.value })} />
            </div>
            {(() => {
              const credential = data.credentials.find((row) => row.user_id === person.id);
              const isOwnerRow = data.owners.some((owner) => owner.user_id === person.id);
              const pending = credential?.must_change_password ?? false;
              const expired = pending && new Date(credential!.expires_at).getTime() <= Date.now();
              if (!pending && !(viewerIsOwner && !isOwnerRow && person.is_active)) return null;
              return <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {pending && <span className={`rounded-full px-2 py-0.5 ${expired ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"}`}>
                  {expired ? "Временный пароль истёк" : `Ожидает смены временного пароля · до ${new Date(credential!.expires_at).toLocaleString("ru-RU")}`}
                </span>}
                {viewerIsOwner && !isOwnerRow && person.is_active && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void reissueTemporaryPassword(person)}>Сгенерировать новый временный пароль</Button>}
              </div>;
            })()}
            {data.credentialManagementAllowed && <div className="mt-3">
              {passwordTargetId === person.id ? <form onSubmit={(event) => void submitPasswordChange(event, person)} className="grid gap-2 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                <Input aria-label="Новый пароль" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordForm.newPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))} placeholder="Новый пароль (от 12 символов)" />
                <Input aria-label="Подтверждение пароля" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))} placeholder="Подтверждение пароля" />
                <Button type="submit" size="sm" disabled={passwordBusy}>{passwordBusy ? "Сохраняем…" : "Сохранить новый пароль"}</Button>
                <Button type="button" variant="outline" size="sm" disabled={passwordBusy} onClick={() => { setPasswordTargetId(null); setPasswordForm({ newPassword: "", confirmPassword: "" }); }}>Отмена</Button>
              </form> : <Button type="button" variant="outline" size="sm" disabled={busy || passwordBusy || !person.is_active} onClick={() => { setPasswordForm({ newPassword: "", confirmPassword: "" }); setPasswordTargetId(person.id); }}>Изменить пароль</Button>}
            </div>}
            {data.mailboxesAllowed && <div className="mt-3 rounded-md border border-border bg-background p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Корпоративная почта</div>
              {(() => {
                const mailbox = data.mailboxes.find((row) => row.user_id === person.id && row.is_primary);
                const proposedEmail = proposals[person.id];
                const statusLabel: Record<string, string> = { pending: "Не подключена", active: "Активна", suspended: "Приостановлена", disabled: "Отключена", error: "Ошибка" };
                return mailbox ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{mailbox.email}</span><span className="text-muted-foreground">Статус: {statusLabel[mailbox.status] ?? mailbox.status}</span>
                  <span className="text-muted-foreground">Провайдер: {mailbox.provider ?? "Не настроен"}</span>
                  <span className="text-muted-foreground">Создана запись: {new Date(mailbox.created_at).toLocaleDateString("ru-RU")}</span>
                  {mailbox.status === "pending" && <span className="text-xs text-muted-foreground">Провайдер не подключён; настоящий ящик не создан.</span>}
                </div> : <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm">Предлагаемый адрес: <strong>{proposedEmail ?? "ещё не сформирован"}</strong></span>
                  {!proposedEmail && <Button variant="outline" size="sm" disabled={busy} onClick={() => void proposeForEmployee(person)}>Предложить адрес</Button>}
                  {proposedEmail && <Button size="sm" disabled={busy} onClick={() => void createMailboxReservation(person.id, proposedEmail)}>Создать корпоративную почту</Button>}
                  <span className="basis-full text-xs text-muted-foreground">Provider: не настроен. Подтверждение адреса зарезервирует его в LUNO DIGITAL, но не создаст внешний почтовый ящик.</span>
                </div>;
              })()}
            </div>}
          </article>;
        })}
      </div>
    </section>

    {(data.capabilities.rolesManage || data.capabilities.accessLevelsManage) && <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Матрица ролей и разрешений</h2>
      <p className="mt-1 text-xs text-muted-foreground">Роль и числовой уровень доступа действуют независимо; критические административные права защищены реестром владельцев.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead><tr className="border-b border-border"><th className="py-2 pr-3">Разрешение</th>{["employee", "manager", "director"].map((r) => <th key={r} className="px-2 py-2">{r}</th>)}{[1,2,3,4,5].map((n) => <th key={n} className="px-2 py-2">Ур. {n}</th>)}</tr></thead>
        <tbody>{data.permissions.map((permission: { key: string; description: string }) => <tr key={permission.key} className="border-b border-border/60"><td className="py-2 pr-3"><div>{permission.key}</div><div className="text-muted-foreground">{permission.description}</div></td>{["employee", "manager", "director"].map((role) => <td key={role} className="px-2 py-2 text-center"><input type="checkbox" checked={rolePermissions.has(`${role}:${permission.key}`)} disabled={busy || !data.capabilities.rolesManage} onChange={(e) => void toggleMatrix("role", role, permission.key, e.target.checked)} /></td>)}{[1,2,3,4,5].map((level) => <td key={level} className="px-2 py-2 text-center"><input type="checkbox" checked={levelPermissions.has(`${level}:${permission.key}`)} disabled={busy || !data.capabilities.accessLevelsManage} onChange={(e) => void toggleMatrix("level", String(level), permission.key, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
    </section>}

    {data.capabilities.systemManage && <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Состояние системы</h2>
      {status ? <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div>База данных: <span className={status.database === "ok" ? "text-primary" : "text-destructive"}>{status.database}</span></div><div>{status.version}</div><div className="text-muted-foreground">Проверено: {new Date(status.checkedAt).toLocaleString("ru-RU")}</div></div> : <p className="mt-2 text-sm text-muted-foreground">Нет доступа к мониторингу или отсутствует серверный ключ.</p>}
    </section>}
  </div>;
}
