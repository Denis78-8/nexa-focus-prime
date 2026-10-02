// Shared by /change-password (hints) and the server function (enforcement).
export const PASSWORD_RULES = [
  { label: "Не короче 12 символов", test: (value: string) => value.length >= 12 },
  { label: "Строчная латинская буква", test: (value: string) => /[a-z]/.test(value) },
  { label: "Заглавная латинская буква", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Цифра", test: (value: string) => /\d/.test(value) },
  { label: "Спецсимвол", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

export const PASSWORD_MAX_LENGTH = 128;

export function passwordMeetsPolicy(value: string) {
  return value.length <= PASSWORD_MAX_LENGTH && PASSWORD_RULES.every((rule) => rule.test(value));
}
