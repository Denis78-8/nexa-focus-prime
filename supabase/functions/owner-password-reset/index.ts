import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "denis.savinov@nexa.ru";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-owner-password-reset-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

function respond(status: number, body: { ok: boolean }) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function constantTimeEqual(candidate: string, expected: string) {
  let difference = candidate.length ^ expected.length;
  const length = Math.max(candidate.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (candidate.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { ok: false });

  const resetToken = request.headers.get("x-owner-password-reset-token") ?? "";
  const expectedResetToken = Deno.env.get("OWNER_PASSWORD_RESET_TOKEN") ?? "";
  if (expectedResetToken.length < 32 || !constantTimeEqual(resetToken, expectedResetToken)) {
    return respond(401, { ok: false });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { ok: false });
  }

  if (!payload || typeof payload !== "object") return respond(400, { ok: false });
  const { newPassword, confirmPassword } = payload as Record<string, unknown>;
  if (
    typeof newPassword !== "string" || typeof confirmPassword !== "string" ||
    newPassword.length < 12 || newPassword.length > 128 || newPassword !== confirmPassword
  ) return respond(400, { ok: false });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return respond(503, { ok: false });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Resolve the immutable Auth UUID from the fixed, confirmed owner email.
    let user: { id: string; email?: string; email_confirmed_at?: string | null } | null = null;
    for (let page = 1; page <= 100 && !user; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return respond(503, { ok: false });
      user = data.users.find((candidate) => candidate.email?.toLowerCase() === OWNER_EMAIL) ?? null;
      if (data.users.length < 1000) break;
    }
    if (!user || !user.email_confirmed_at || user.email?.toLowerCase() !== OWNER_EMAIL) {
      return respond(403, { ok: false });
    }

    const { data: owner, error: ownerError } = await admin
      .from("nexa_owners")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (ownerError || owner?.user_id !== user.id) return respond(403, { ok: false });

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) return respond(400, { ok: false });

    return respond(200, { ok: true });
  } catch {
    // Never log request data or expose Auth/Admin errors to the caller.
    return respond(500, { ok: false });
  }
});
