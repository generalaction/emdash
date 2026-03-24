export const LOCALE_ENV_VARS = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const;
export const DEFAULT_UTF8_LOCALE = 'C.UTF-8';

export function isUtf8Locale(value: string | undefined): boolean {
  return typeof value === 'string' && /utf-?8/i.test(value);
}
