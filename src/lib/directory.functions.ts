import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Read-only employee directory. Uses only existing read paths, as the caller:
 *  - profiles: public columns, rows limited by the existing RLS policy
 *    (own profile, project colleagues, or everyone with profiles.read_all);
 *  - get_my_nexa_access_flags(): the caller's own level/role/active flag;
 *  - get_admin_panel_data(): private fields for everyone, only when the caller
 *    already has admin.access + employees.read + profiles.private.read
 *    (the RPC enforces that itself).
 * Fields the caller may not see are returned as null, never guessed.
 */
export type DirectoryEmployee = {
  id: string;
  full_name: string;
  position: string | null;
  department: string | null;
  avatar_url: string | null;
  presence: string;
  created_at: string;
  is_vip: boolean;
  /** Public "Директор" badge (get_visible_profile_badges), visible to everyone who sees the profile. */
  is_director: boolean;
  email: string | null;
  phone: string | null;
  location: string | null;
  access_level: number | null;
  role: string | null;
  is_active: boolean | null;
};

export type EmployeeDirectory = {
  currentUserId: string;
  /** Private fields (contacts, level, role) are available for all employees. */
  privateFieldsVisible: boolean;
  employees: DirectoryEmployee[];
};

type PanelEmployee = {
  id: string; email: string | null; phone: string | null; location: string | null;
  access_level: number | null; is_active: boolean | null;
};
type PanelData = { employees?: PanelEmployee[]; roles?: { user_id: string; role: string }[]; owners?: { user_id: string }[] };

const ROLE_PRIORITY = ["admin", "director", "manager", "employee"];

function primaryRole(userId: string, panel: PanelData) {
  if (panel.owners?.some((owner) => owner.user_id === userId)) return "admin";
  const roles = (panel.roles ?? []).filter((row) => row.user_id === userId).map((row) => row.role);
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? (roles.length ? roles[0]! : "employee");
}

export const getEmployeeDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmployeeDirectory> => {
    const client = context.supabase;
    const { data: profiles, error } = await client
      .from("profiles")
      .select("id, full_name, position, department, avatar_url, presence, created_at, is_vip")
      .order("full_name");
    if (error) throw new Error(error.message);

    // Private columns only through the permission-checked admin RPC.
    let panel: PanelData | null = null;
    const [{ data: canAdmin }, { data: canReadEmployees }, { data: canReadPrivate }] = await Promise.all([
      client.rpc("has_permission", { _permission: "admin.access" }),
      client.rpc("has_permission", { _permission: "employees.read" }),
      client.rpc("has_permission", { _permission: "profiles.private.read" }),
    ]);
    if (canAdmin === true && canReadEmployees === true && canReadPrivate === true) {
      const { data, error: panelError } = await client.rpc("get_admin_panel_data");
      if (!panelError && data && typeof data === "object" && !Array.isArray(data)) panel = data as PanelData;
    }

    // Public director badge only; no other role data for profiles of others.
    const badgeClient = client as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> };
    const { data: badgeRows } = await badgeClient.rpc("get_visible_profile_badges");
    const directors = new Set(
      (Array.isArray(badgeRows) ? badgeRows as { id: string; is_director: boolean }[] : [])
        .filter((row) => row.is_director)
        .map((row) => row.id),
    );

    // The caller always may see their own level, role and active flag.
    const { data: ownFlags } = await client.rpc("get_my_nexa_access_flags");
    const own = ownFlags && typeof ownFlags === "object" && !Array.isArray(ownFlags)
      ? ownFlags as { access_level?: unknown; role?: unknown; is_active?: unknown }
      : null;
    const ownEmail = typeof context.claims.email === "string" ? context.claims.email : null;

    const privateById = new Map((panel?.employees ?? []).map((employee) => [employee.id, employee]));
    const employees = (profiles ?? []).map((profile): DirectoryEmployee => {
      const privateRow = privateById.get(profile.id);
      const isSelf = profile.id === context.userId;
      return {
        ...profile,
        is_director: directors.has(profile.id) || (isSelf && own?.role === "director"),
        email: privateRow?.email ?? (isSelf ? ownEmail : null),
        phone: privateRow?.phone ?? null,
        location: privateRow?.location ?? null,
        access_level: privateRow?.access_level ?? (isSelf && typeof own?.access_level === "number" ? own.access_level : null),
        role: panel ? primaryRole(profile.id, panel) : isSelf && typeof own?.role === "string" ? own.role : directors.has(profile.id) ? "director" : null,
        is_active: privateRow?.is_active ?? (isSelf && typeof own?.is_active === "boolean" ? own.is_active : null),
      };
    });

    return { currentUserId: context.userId, privateFieldsVisible: panel !== null, employees };
  });
