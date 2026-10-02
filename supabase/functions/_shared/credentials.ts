// Validity window of a system-issued temporary password; stored as
// employee_credentials.expires_at and enforced by get_my_credential_state()
// and complete-password-change.
export const TEMPORARY_PASSWORD_TTL_HOURS = 72;

export function temporaryPasswordExpiry(from = new Date()) {
  return new Date(from.getTime() + TEMPORARY_PASSWORD_TTL_HOURS * 60 * 60 * 1000);
}

// Ambiguous characters (0/O, 1/l/I) are excluded so the password can be
// retyped without mistakes.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/** Unbiased random index in [0, max) from the Web Crypto CSPRNG. */
function randomIndex(max: number) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % max;
}

const pick = (alphabet: string) => alphabet[randomIndex(alphabet.length)];

/** Temporary password: never stored, logged or returned more than once. */
export function generateTemporaryPassword(length = 20) {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Mirrors src/lib/password-policy.ts (UI hints); this copy is the enforcement.
export const PASSWORD_MAX_LENGTH = 128;
export function passwordMeetsPolicy(value: string) {
  return value.length >= 12 && value.length <= PASSWORD_MAX_LENGTH
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}
