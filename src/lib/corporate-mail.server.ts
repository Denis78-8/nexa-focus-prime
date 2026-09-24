export type MailboxStatus = "pending" | "active" | "suspended" | "disabled" | "error";
export type ProviderNotConfigured = { ok: false; code: "provider_not_configured" | "provider_error" };
export type ProviderResult<T = undefined> = { ok: true; value: T } | ProviderNotConfigured;

export type CorporateMailbox = {
  id: string;
  userId: string;
  email: string;
  localPart: string;
  domain: string;
  provider: string | null;
  providerUserId: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CorporateMailProvider = {
  createMailbox(input: { email: string; displayName: string }): Promise<ProviderResult<{ provider: string; providerUserId: string | null }>>;
  disableMailbox(mailbox: CorporateMailbox): Promise<ProviderResult>;
  enableMailbox(mailbox: CorporateMailbox): Promise<ProviderResult>;
  deleteMailbox(mailbox: CorporateMailbox): Promise<ProviderResult>;
  getMailbox(email: string): Promise<ProviderResult<CorporateMailbox>>;
  sendInvitation(input: { email: string; inviteUrl: string }): Promise<ProviderResult>;
};

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

export function getCorporateMailDomain() {
  const domain = (process.env["NEXA_MAIL_DOMAIN"] ?? "nexa.ru").trim().replace(/\.$/, "").toLowerCase();
  if (domain.length > 253 || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Некорректно настроен NEXA_MAIL_DOMAIN");
  }
  return domain;
}

export function generateCorporateLocalPart(fullName: string) {
  const normalized = fullName.trim().replace(/[’'`]/g, "").replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) throw new Error("Укажите корректные имя и фамилию");
  const tokens = normalized.split(" ").map((token) => transliterate(token).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")).filter(Boolean);
  if (tokens.length < 2) throw new Error("Для адреса нужны имя и фамилия латинскими или кириллическими буквами");

  // The first token is the given name; remaining tokens preserve multi-part
  // and hyphenated surnames without guessing a mail password or account name.
  const localPart = [tokens[0], ...tokens.slice(1)].join(".").replace(/\.{2,}/g, ".").slice(0, 64).replace(/[.-]+$/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(localPart)) {
    throw new Error("Имя нельзя безопасно преобразовать в адрес корпоративной почты");
  }
  return localPart;
}

export function isValidCorporateEmail(email: string, domain = getCorporateMailDomain()) {
  if (email.length > 254 || email !== email.toLowerCase()) return false;
  const [localPart, ...domainParts] = email.split("@");
  if (!localPart || domainParts.length !== 1 || domainParts[0] !== domain || localPart.length > 64) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(localPart);
}

export const nullCorporateMailProvider: CorporateMailProvider = {
  async createMailbox() { return { ok: false, code: "provider_not_configured" }; },
  async disableMailbox() { return { ok: false, code: "provider_not_configured" }; },
  async enableMailbox() { return { ok: false, code: "provider_not_configured" }; },
  async deleteMailbox() { return { ok: false, code: "provider_not_configured" }; },
  async getMailbox() { return { ok: false, code: "provider_not_configured" }; },
  async sendInvitation() { return { ok: false, code: "provider_not_configured" }; },
};

export function getCorporateMailProvider(): CorporateMailProvider {
  // Deliberately returns a truthful no-op until a real provider is configured.
  return nullCorporateMailProvider;
}
