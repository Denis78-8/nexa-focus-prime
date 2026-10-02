import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

// Same rules as src/lib/corporate-mail.server.ts, which the app keeps using
// for mailbox proposals; edge functions cannot import from src/.
const CYRILLIC_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

function transliterate(value: string) {
  return Array.from(value.normalize("NFC").toLowerCase()).map((char) => {
    if (CYRILLIC_LATIN[char] !== undefined) return CYRILLIC_LATIN[char];
    return char.normalize("NFKD").replace(/\p{M}/gu, "");
  }).join("");
}

function corporateDomain() {
  const domain = (Deno.env.get("NEXA_MAIL_DOMAIN") ?? "nexa.ru").trim().replace(/\.$/, "").toLowerCase();
  if (domain.length > 253 || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new HttpError(503, "Некорректно настроен NEXA_MAIL_DOMAIN");
  }
  return domain;
}

function localPartFor(fullName: string) {
  const normalized = fullName.trim().replace(/[’'`]/g, "").replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) throw new HttpError(400, "Укажите корректные имя и фамилию");
  const tokens = normalized.split(" ")
    .map((token) => transliterate(token).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
  if (tokens.length < 2) throw new HttpError(400, "Для логина нужны имя и фамилия латинскими или кириллическими буквами");
  const localPart = tokens.join(".").replace(/\.{2,}/g, ".").slice(0, 64).replace(/[.-]+$/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(localPart)) {
    throw new HttpError(400, "Имя нельзя безопасно преобразовать в корпоративный логин");
  }
  return localPart;
}

/** First free corporate address for the name, checked against mailboxes and profiles. */
export async function availableCorporateLogin(admin: SupabaseClient, fullName: string) {
  const base = localPartFor(fullName);
  const domain = corporateDomain();
  const [mailboxes, profiles] = await Promise.all([
    admin.from("corporate_mailboxes").select("email"),
    admin.from("profiles").select("email").not("email", "is", null),
  ]);
  if (mailboxes.error || profiles.error) throw new HttpError(503, "Не удалось проверить занятые адреса");
  const occupied = new Set<string>([
    ...(mailboxes.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
    ...(profiles.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
  ]);
  for (let suffix = 1; suffix <= 10000; suffix += 1) {
    const marker = suffix === 1 ? "" : String(suffix);
    const email = `${base.slice(0, 64 - marker.length)}${marker}@${domain}`;
    if (!occupied.has(email)) return email;
  }
  throw new HttpError(409, "Не удалось подобрать свободный корпоративный логин");
}
