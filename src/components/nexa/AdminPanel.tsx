import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminData, getSystemStatus, inviteEmployee, reserveCorporateMailbox, suggestCorporateEmail, updateEmployee, updateEmployeePassword, updatePermissionMatrix } from "@/lib/admin.functions";

type Employee = { id: string; full_name: string; email: string | null; position: string | null; department: string | null; phone: string | null; location: string | null; access_level: number; is_vip: boolean; is_active: boolean; mailbox_status: string; invitation_status: string };
type AdminData = { employees: Employee[]; roles: { user_id: string; role: string }[]; permissions: { key: string; description: string }[]; rolePermissions: { role: string; permission_key: string }[]; levelPermissions: { access_level: number; permission_key: string }[]; owners: { user_id: string }[]; mailboxes: { id: string; user_id: string; email: string; local_part: string; domain: string; status: string; provider: string | null; is_primary: boolean; created_at: string }[]; credentialManagementAllowed: boolean };
type Role = "employee" | "manager" | "director" | "admin";
type InviteRole = Exclude<Role, "admin">;
type EmployeeDraft = { role: Role; accessLevel: number; isVip: boolean; isActive: boolean; fullName: string; position: string; department: string; phone: string; location: string };

export function AdminPanel() {
  const load = useServerFn(getAdminData);
  const invite = useServerFn(inviteEmployee);
  const saveEmployee = useServerFn(updateEmployee);
  const setMatrix = useServerFn(updatePermissionMatrix);
  const loadStatus = useServerFn(getSystemStatus);
  const suggestEmail = useServerFn(suggestCorporateEmail);
  const reserveMailbox = useServerFn(reserveCorporateMailbox);
  const changeEmployeePassword = useServerFn(updateEmployeePassword);
  const [data, setData] = useState<AdminData | null>(null);
  const [status, setStatus] = useState<{ database: string; checkedAt: string; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordTargetId, setPasswordTargetId] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [drafts, setDrafts] = useState<Record<string, EmployeeDraft>>({});
  const [proposals, setProposals] = useState<Record<string, string>>({});
  const [formProposal, setFormProposal] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", fullName: "", position: "", department: "", role: "employee" as InviteRole, accessLevel: 2 });

  const refresh = async () => {
    try {
      const result = await load();
      setData(result);
      setDrafts(Object.fromEntries(result.employees.map((person: Employee) => [person.id, {
        role: (result.owners.some((owner: { user_id: string }) => owner.user_id === person.id) ? "admin" : result.roles.find((r: { user_id: string; role: string }) => r.user_id === person.id)?.role ?? "employee") as Role,
        accessLevel: person.access_level,
        isVip: person.is_vip,
        isActive: person.is_active,
        fullName: person.full_name,
        position: person.position ?? "",
        department: person.department ?? "",
        phone: person.phone ?? "",
        location: person.location ?? "",
      }])));
      try { setStatus(await loadStatus()); } catch { setStatus(null); }
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const fullName = form.fullName.trim();
    if (fullName.length < 2) { setFormProposal(null); return; }
    const timer = window.setTimeout(() => {
      suggestEmail({ data: { fullName } }).then((result) => setFormProposal(result.email)).catch(() => setFormProposal(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [form.fullName, suggestEmail]);

  const toggleMatrix = async (kind: "role" | "level", subject: string, permission: string, enabled: boolean) => {
    setBusy(true);
    try {
      await setMatrix({ data: { kind, subject, permission, enabled } });
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const sendInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await invite({ data: { ...form, position: form.position || undefined, department: form.department || undefined } });
      setProposals((current) => ({ ...current, [result.userId]: result.corporateEmailProposal }));
      toast.success("Приглашение Supabase Auth отправлено; почтовый ящик ещё не создан");
      setForm({ email: "", fullName: "", position: "", department: "", role: "employee", accessLevel: 2 });
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const createMailboxReservation = async (userId: string, email: string) => {
    setBusy(true);
    try {
      const result = await reserveMailbox({ data: { userId, email } });
      setProposals((current) => { const next = { ...current }; delete next[userId]; return next; });
      if (result.provisioning === "provider_not_configured") {
        toast.message(`Адрес ${result.mailbox.email} зарезервирован в NEXA. Реальный почтовый ящик не создан: провайдер не подключён.`);
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
      const proposal = await suggestEmail({ data: { fullName: person.full_name } });
      setProposals((current) => ({ ...current, [person.id]: proposal.email }));
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const save = async (person: Employee) => {
    const draft = drafts[person.id];
    if (!draft) return;
    setBusy(true);
    try {
      await saveEmployee({ data: { id: person.id, fullName: draft.fullName, position: draft.position || null, department: draft.department || null, phone: draft.phone || null, location: draft.location || null, role: draft.role, accessLevel: draft.accessLevel, isVip: draft.isVip, isActive: draft.isActive } });
      toast.success("Профиль сотрудника сохранён");
      await refresh();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
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

  if (!data) return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Загрузка панели администратора…</div>;

  return <div className="space-y-8">
    <header>
      <h1 className="text-xl font-semibold">NEXA Admin Panel</h1>
      <p className="mt-1 text-sm text-muted-foreground">Сотрудники, доступ и состояние системы. Каждое изменение проверяется сервером.</p>
    </header>

    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Пригласить сотрудника</h2>
      <form onSubmit={sendInvite} className="mt-4 grid gap-3 md:grid-cols-3">
        <Input required type="email" placeholder="Email для входа и приглашения Supabase Auth" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input required placeholder="Имя и фамилия" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <Input placeholder="Должность" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        <Input placeholder="Отдел" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as InviteRole })}>
          <option value="employee">Сотрудник</option><option value="manager">Менеджер</option><option value="director">Руководитель</option>
        </select>
        <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.accessLevel} onChange={(e) => setForm({ ...form, accessLevel: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Уровень {level}</option>)}
        </select>
        <Button disabled={busy} className="md:col-span-3">Отправить приглашение</Button>
      </form>
      <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
        <span className="text-muted-foreground">Предложение корпоративного адреса: </span>
        <span className="font-medium">{formProposal || "Введите имя и фамилию"}</span>
        <p className="mt-1 text-xs text-muted-foreground">Адрес будет предложен отдельно от email входа. Пароль не создаётся и не хранится. Real mailbox provisioning is not configured yet.</p>
      </div>
    </section>

    <section>
      <div className="mb-3 flex items-baseline justify-between"><h2 className="text-sm font-semibold">Сотрудники · {data.employees.length}</h2><Button variant="outline" size="sm" onClick={() => void refresh()}>Обновить</Button></div>
      <div className="space-y-3">
        {data.employees.map((person: Employee) => {
          const draft = drafts[person.id];
          if (!draft) return null;
          return <article key={person.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-medium">{person.full_name}{data.owners.some((owner) => owner.user_id === person.id) && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">Владелец</span>}</div><div className="mt-1 text-xs text-muted-foreground">Auth: {person.email} · {person.department || "Без отдела"} · Приглашение: {person.invitation_status}</div></div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Роль" disabled={data.owners.some((owner) => owner.user_id === person.id)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={draft.role} onChange={(e) => patchDraft(person.id, { role: e.target.value as Role })}><option value="employee">Сотрудник</option><option value="manager">Менеджер</option><option value="director">Руководитель</option><option value="admin">Администратор</option></select>
                <select aria-label="Уровень доступа" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={draft.accessLevel} onChange={(e) => patchDraft(person.id, { accessLevel: Number(e.target.value) })}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>Уровень {level}</option>)}</select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.isVip} onChange={(e) => patchDraft(person.id, { isVip: e.target.checked })} /> VIP</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.isActive} onChange={(e) => patchDraft(person.id, { isActive: e.target.checked })} /> Активен</label>
                <Button size="sm" disabled={busy} onClick={() => void save(person)}>Сохранить</Button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input aria-label="Имя сотрудника" value={draft.fullName} onChange={(e) => patchDraft(person.id, { fullName: e.target.value })} />
              <Input aria-label="Должность" placeholder="Должность" value={draft.position} onChange={(e) => patchDraft(person.id, { position: e.target.value })} />
              <Input aria-label="Отдел" placeholder="Отдел" value={draft.department} onChange={(e) => patchDraft(person.id, { department: e.target.value })} />
              <Input aria-label="Телефон" placeholder="Телефон" value={draft.phone} onChange={(e) => patchDraft(person.id, { phone: e.target.value })} />
              <Input aria-label="Локация" placeholder="Локация" value={draft.location} onChange={(e) => patchDraft(person.id, { location: e.target.value })} />
            </div>
            {data.credentialManagementAllowed && <div className="mt-3">
              {passwordTargetId === person.id ? <form onSubmit={(event) => void submitPasswordChange(event, person)} className="grid gap-2 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                <Input aria-label="Новый пароль" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordForm.newPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, newPassword: e.target.value }))} placeholder="Новый пароль (от 12 символов)" />
                <Input aria-label="Подтверждение пароля" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((current) => ({ ...current, confirmPassword: e.target.value }))} placeholder="Подтверждение пароля" />
                <Button type="submit" size="sm" disabled={passwordBusy}>{passwordBusy ? "Сохраняем…" : "Сохранить новый пароль"}</Button>
                <Button type="button" variant="outline" size="sm" disabled={passwordBusy} onClick={() => { setPasswordTargetId(null); setPasswordForm({ newPassword: "", confirmPassword: "" }); }}>Отмена</Button>
              </form> : <Button type="button" variant="outline" size="sm" disabled={busy || passwordBusy || !person.is_active} onClick={() => { setPasswordForm({ newPassword: "", confirmPassword: "" }); setPasswordTargetId(person.id); }}>Изменить пароль</Button>}
            </div>}
            <div className="mt-3 rounded-md border border-border bg-background p-3">
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
                  <span className="basis-full text-xs text-muted-foreground">Provider: не настроен. Подтверждение адреса зарезервирует его в NEXA, но не создаст внешний почтовый ящик.</span>
                </div>;
              })()}
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Матрица ролей и разрешений</h2>
      <p className="mt-1 text-xs text-muted-foreground">Роль и числовой уровень доступа действуют независимо; критические административные права защищены реестром владельцев.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead><tr className="border-b border-border"><th className="py-2 pr-3">Разрешение</th>{["employee", "manager", "director"].map((r) => <th key={r} className="px-2 py-2">{r}</th>)}{[1,2,3,4,5].map((n) => <th key={n} className="px-2 py-2">Ур. {n}</th>)}</tr></thead>
        <tbody>{data.permissions.map((permission: { key: string; description: string }) => <tr key={permission.key} className="border-b border-border/60"><td className="py-2 pr-3"><div>{permission.key}</div><div className="text-muted-foreground">{permission.description}</div></td>{["employee", "manager", "director"].map((role) => <td key={role} className="px-2 py-2 text-center"><input type="checkbox" checked={rolePermissions.has(`${role}:${permission.key}`)} disabled={busy} onChange={(e) => void toggleMatrix("role", role, permission.key, e.target.checked)} /></td>)}{[1,2,3,4,5].map((level) => <td key={level} className="px-2 py-2 text-center"><input type="checkbox" checked={levelPermissions.has(`${level}:${permission.key}`)} disabled={busy} onChange={(e) => void toggleMatrix("level", String(level), permission.key, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
    </section>

    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Состояние системы</h2>
      {status ? <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div>База данных: <span className={status.database === "ok" ? "text-primary" : "text-destructive"}>{status.database}</span></div><div>{status.version}</div><div className="text-muted-foreground">Проверено: {new Date(status.checkedAt).toLocaleString("ru-RU")}</div></div> : <p className="mt-2 text-sm text-muted-foreground">Нет доступа к мониторингу или отсутствует серверный ключ.</p>}
    </section>
  </div>;
}
