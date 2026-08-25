import fs from 'node:fs';
import path from 'node:path';
import type { Locale } from './types.js';

export type { Locale };

type TranslationParams = Record<string, string | number>;

export const DEFAULT_LOCALE: Locale = 'en';

function loadLocale(locale: Locale): Record<string, string> {
  const filePath = path.resolve(import.meta.dirname, 'locales', `${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, string>;
}

const messages: Record<Locale, Record<string, string>> = {
  ru: loadLocale('ru'),
  en: loadLocale('en'),
};

/** Every key present in the English locale (the reference locale). */
export type TranslationKey = keyof (typeof messages)['en'];

/**
 * Look up a translated string for the given locale,
 * optionally interpolating `{param}` placeholders.
 */
export function t(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template: string | undefined = messages[locale][key];
  if (template == null) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

const ALL_LOCALES: Locale[] = ['ru', 'en'];

/**
 * Returns a RegExp that matches the verification-code message in **any**
 * supported locale.  The first capture group is the code itself.
 *
 * Example pattern: `^(?:<ru prefix>|VERIFICATION CODE): (\w{4,})$`
 */
export function verificationCodeRegexAnyLocale(): RegExp {
  const prefixes = ALL_LOCALES.map((locale) => {
    const prefix = messages[locale]['discord.verification.codePrefix'];
    return prefix ? prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  }).filter(Boolean);
  return new RegExp(`^(?:${prefixes.join('|')}): (\\w{4,})$`);
}
