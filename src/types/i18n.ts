// src/types/i18n.ts
export const LOCALES = ['uz', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz';

/** public.i18n_text. Keys optional individually; at least one non-empty (DB-enforced). */
export type I18nText = Partial<Record<Locale, string>>;

/** BCP-47 tags used for Intl formatting. */
export const BCP47: Readonly<Record<Locale, string>> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

/** Dot-path into messages/<locale>.json, e.g. 'errors.app.TABLE_INACTIVE'. */
export type MessageKey = string;
export type Messages = Readonly<Record<MessageKey, string>>;
