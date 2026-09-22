import type { FocusEvent, KeyboardEvent } from "react";
import { z } from "zod";

/**
 * Жорстка валідація українських реквізитів (телефон / ПІБ / IBAN) + маски вводу.
 * Єдине джерело правди: використовується у формах реєстрації, адмін-панелі та профілях.
 */

// ---------------------------------------------------------------------------
// Телефон
// ---------------------------------------------------------------------------

/** Код країни українських номерів. */
export const UA_PHONE_PREFIX = "+380";
/** Повна довжина номера: +380 + 9 цифр = 13 символів. */
export const UA_PHONE_LENGTH = 13;

/** Валідні коди операторів / міст України. */
export const UA_PHONE_OPERATOR_CODES = [
  "39", "44", "50", "63", "66", "67", "68", "73",
  "89", "91", "92", "93", "94", "95", "96", "97", "98", "99",
] as const;

/** +380 + код оператора + рівно 7 цифр (усього 13 символів). */
export const UA_PHONE_REGEX = new RegExp(
  `^\\+380(${UA_PHONE_OPERATOR_CODES.join("|")})\\d{7}$`,
);

export const UA_PHONE_ERROR =
  "Телефон: +380, код оператора та 7 цифр (напр. +380671234567)";

// ---------------------------------------------------------------------------
// IBAN
// ---------------------------------------------------------------------------

export const UA_IBAN_PREFIX = "UA";
/** UA + 27 цифр = 29 символів. */
export const UA_IBAN_LENGTH = 29;
export const UA_IBAN_REGEX = /^UA\d{27}$/;
export const UA_IBAN_ERROR = "IBAN: латиницею UA + 27 цифр (рівно 29 символів)";

// ---------------------------------------------------------------------------
// ПІБ
// ---------------------------------------------------------------------------

/** Одне слово ПІБ: українські літери + апостроф/дефіс усередині. */
export const UA_NAME_WORD_REGEX =
  /^[А-Яа-яІіЇїЄєҐґ]+(?:['’-][А-Яа-яІіЇїЄєҐґ]+)*$/;

/** Одне слово ПІБ латиницею (для власника рахунку в банку). */
export const LATIN_NAME_WORD_REGEX = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;

export const UA_NAME_ERROR =
  "ПІБ: лише українські літери, рівно 2 або 3 слова (напр. Іваненко Іван Іванович)";

export const BANK_HOLDER_NAME_ERROR =
  "ПІБ власника рахунку: рівно 2 або 3 слова (українською або латиницею)";

// ---------------------------------------------------------------------------
// Перевірки (чисті функції)
// ---------------------------------------------------------------------------

export function uaPhoneDigits(value: string): string {
  return (value || "").replace(/\D/g, "").slice(0, UA_PHONE_LENGTH - 1);
}

export function isValidUaPhone(value?: string | null): boolean {
  return UA_PHONE_REGEX.test((value || "").trim());
}

export function isValidUaIban(value?: string | null): boolean {
  return UA_IBAN_REGEX.test((value || "").trim().toUpperCase());
}

export function splitNameWords(value: string): string[] {
  return (value || "").trim().split(/\s+/).filter(Boolean);
}

/** ПІБ: строго 2 або 3 слова, кожне — українські літери (апостроф/дефіс дозволені). */
export function isValidUaFullName(value?: string | null): boolean {
  const words = splitNameWords(value || "");
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => word.length >= 2 && UA_NAME_WORD_REGEX.test(word));
}

/** ПІБ власника рахунку: 2 або 3 слова, українською або латиницею (вимога банків). */
export function isValidBankHolderName(value?: string | null): boolean {
  const words = splitNameWords(value || "");
  if (words.length < 2 || words.length > 3) return false;
  return words.every(
    (word) =>
      word.length >= 2 &&
      (UA_NAME_WORD_REGEX.test(word) || LATIN_NAME_WORD_REGEX.test(word)),
  );
}

// ---------------------------------------------------------------------------
// Zod-схеми для форм
// ---------------------------------------------------------------------------

export const uaPhoneSchema = (message: string = UA_PHONE_ERROR) =>
  z.string().trim().regex(UA_PHONE_REGEX, message);

export const uaIbanSchema = (message: string = UA_IBAN_ERROR) =>
  z.string().trim().regex(UA_IBAN_REGEX, message);

export const uaFullNameSchema = (message: string = UA_NAME_ERROR) =>
  z.string().trim().refine(isValidUaFullName, { message });

export const bankHolderNameSchema = (message: string = BANK_HOLDER_NAME_ERROR) =>
  z.string().trim().refine(isValidBankHolderName, { message });

// ---------------------------------------------------------------------------
// Маски вводу (використовуються в обробниках Input)
// ---------------------------------------------------------------------------

/**
 * Маска телефону: тримає формат +380XXXXXXXXX (13 символів).
 * Локальні формати (0XX…, 80XX…, XX… — до 9 цифр) автоматично доводить до +380.
 */
export function applyUaPhoneMask(rawValue: string): string {
  let digits = uaPhoneDigits(rawValue);
  if (!digits) return "";
  if (!digits.startsWith("380")) {
    if (digits.startsWith("80")) digits = `3${digits}`;
    else if (digits.startsWith("0")) digits = `38${digits}`;
    else if (digits.length <= 9) digits = `380${digits}`;
    else if (!digits.startsWith("3")) digits = `380${digits}`;
  }
  return `+${digits.slice(0, UA_PHONE_LENGTH - 1)}`;
}

/**
 * Нормалізує вже збережений телефон (профіль/магазин).
 * Іноземні номери не переписує — їх просто відхилить валідація.
 */
export function normalizeUaPhone(value?: string | null): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const looksUkrainian =
    raw.startsWith(UA_PHONE_PREFIX) ||
    digits.startsWith("380") ||
    digits.startsWith("80") ||
    digits.startsWith("0");
  if (!looksUkrainian) return raw;
  return applyUaPhoneMask(raw);
}

/** Маска IBAN: тільки A-Z0-9, верхній регістр, максимум 29 символів. */
export function applyUaIbanMask(rawValue: string): string {
  return (rawValue || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, UA_IBAN_LENGTH);
}

// ---------------------------------------------------------------------------
// Обробники для <input> (маски + заборона видалення префікса)
// ---------------------------------------------------------------------------

/** Фокус на порожньому полі: підставляє префікс (напр. "+380" або "UA"). */
export function insertUaPrefixOnFocus(
  event: FocusEvent<HTMLInputElement>,
  applyValue: (value: string) => void,
  prefix: string,
): void {
  const element = event.currentTarget;
  if (element.value.trim()) return;
  applyValue(prefix);
  requestAnimationFrame(() => {
    try {
      element.setSelectionRange(prefix.length, prefix.length);
    } catch {
      /* деякі типи input не підтримують setSelectionRange */
    }
  });
}

/** true, якщо натиснута клавіша видалення намагається стерти префікс (+380 / UA). */
export function blocksPrefixDeletion(
  event: KeyboardEvent<HTMLInputElement>,
  prefix: string,
): boolean {
  if (event.key !== "Backspace" && event.key !== "Delete") return false;
  const start = event.currentTarget.selectionStart ?? 0;
  const end = event.currentTarget.selectionEnd ?? 0;
  if (event.key === "Backspace") {
    return start <= prefix.length && end <= prefix.length;
  }
  return start < prefix.length;
}