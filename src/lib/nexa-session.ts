// Идентификатор текущей пользовательской сессии (вкладки). Пишется в интервалы таймера и историю.
export function getNexaSessionId(): string {
  if (typeof window === "undefined") return "ssr-session";
  const key = "nexa-session-id";
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
