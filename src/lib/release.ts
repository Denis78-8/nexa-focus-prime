// The single source of the LUNO DIGITAL version and its release notes.
//
// For the next release: bump `version`, set `date`, replace `changes`. Every
// user then sees "Что нового" once more (the "seen" mark is stored per user
// and per version, see src/lib/whats-new.ts). The Admin Panel system status
// shows the same `version`.
//
// Versioning: semantic, MAJOR.MINOR.PATCH. The product had no explicit
// version before; the interface it replaced counts as 1.x, and this release —
// a full redesign of every screen — is the first major one, 2.0.0. Next
// releases: new functionality → MINOR, fixes only → PATCH.

export type ReleaseChangeIcon = "style" | "navigation" | "tasks" | "settings" | "notifications";

export type ReleaseNotes = {
  version: string;
  /** Release date, ISO yyyy-mm-dd. */
  date: string;
  title: string;
  summary: string;
  changes: readonly { icon: ReleaseChangeIcon; title: string; text: string }[];
};

export const CURRENT_RELEASE: ReleaseNotes = {
  version: "2.0.0",
  date: "2026-10-11",
  title: "Что нового в LUNO DIGITAL",
  summary:
    "Мы обновили рабочее пространство команды, чтобы ежедневная работа была удобнее, а интерфейс — быстрее, понятнее и приятнее.",
  changes: [
    {
      icon: "style",
      title: "Новый визуальный стиль",
      text: "Обновлённое рабочее пространство: тёмная графитовая палитра, фирменные оранжевые акценты, новый фон с затмением и единый стиль интерфейса.",
    },
    {
      icon: "navigation",
      title: "Более плавная навигация",
      text: "Обновлённая навигация, анимированный индикатор активной вкладки и более последовательные переходы между рабочими разделами.",
    },
    {
      icon: "tasks",
      title: "Улучшенная работа с задачами",
      text: "Обновлённое отображение задач, свёрнутая группа завершённых задач, более компактное представление комментариев и истории, улучшения мобильного интерфейса.",
    },
    {
      icon: "settings",
      title: "Обновлённые настройки и администрирование",
      text: "Новые визуальные компоненты настроек, компактное представление сотрудников, улучшенная матрица прав и более понятные подписи состояний.",
    },
    {
      icon: "notifications",
      title: "Уведомления и база знаний",
      text: "Более удобная организация уведомлений, заявок на доступ, материалов базы знаний и редактора статей.",
    },
  ],
};

export const APP_VERSION = CURRENT_RELEASE.version;

/** "11 октября 2026" */
export function releaseDateLabel(release: ReleaseNotes = CURRENT_RELEASE) {
  const [year, month, day] = release.date.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1))
    .replace(/\s*г\.$/, "");
}
