// CORS is limited to known NEXA origins. Extra origins (e.g. the published
// app domain) come from the NEXA_ALLOWED_ORIGINS secret, comma-separated.
const DEFAULT_ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080"];

function allowedOrigins() {
  const extra = (Deno.env.get("NEXA_ALLOWED_ORIGINS") ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function json(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

/** Error response with a safe, user-facing message (never secrets or passwords). */
export function fail(request: Request, status: number, message: string) {
  return json(request, status, { ok: false, error: message });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Shared request wrapper: CORS preflight, POST only, JSON body, safe errors. */
export function serve(handler: (request: Request, body: Record<string, unknown>) => Promise<Response>) {
  Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
    if (request.method !== "POST") return fail(request, 405, "Метод не поддерживается");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(request, 400, "Некорректный запрос");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(request, 400, "Некорректный запрос");
    try {
      return await handler(request, body as Record<string, unknown>);
    } catch (error) {
      if (error instanceof HttpError) return fail(request, error.status, error.message);
      // Unexpected failures: log only the error name, never request data.
      console.error("[nexa-edge] unexpected failure", error instanceof Error ? error.name : "unknown");
      return fail(request, 500, "Внутренняя ошибка сервера");
    }
  });
}
