// "Что нового" is shown once per user and per version in this browser. The
// mark lives only in localStorage (no backend): another device or a cleared
// browser shows the notes again, which is acceptable for release notes.
//
// Key: luno-digital:whats-new:<user-id>:<version>, value: when it was dismissed.

const PREFIX = "luno-digital:whats-new";

type MarkStorage = Pick<Storage, "getItem" | "setItem">;

export function whatsNewKey(userId: string, version: string) {
  return `${PREFIX}:${userId}:${version}`;
}

function browserStorage(): MarkStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * True when this user has not yet dismissed the notes of `version` here.
 * When storage is unavailable the answer is false: without a place to
 * remember the dismissal the window would come back on every load.
 */
export function shouldShowWhatsNew(
  userId: string,
  version: string,
  storage: MarkStorage | null = browserStorage(),
) {
  if (!storage || !userId || !version) return false;
  try {
    return storage.getItem(whatsNewKey(userId, version)) === null;
  } catch {
    return false;
  }
}

/** Remembers that the user dismissed the notes of `version` (button, ✕ or Escape). */
export function markWhatsNewSeen(
  userId: string,
  version: string,
  storage: MarkStorage | null = browserStorage(),
) {
  if (!storage || !userId || !version) return;
  try {
    storage.setItem(whatsNewKey(userId, version), new Date().toISOString());
  } catch {
    // Storage full or blocked: the window may show again next time.
  }
}
