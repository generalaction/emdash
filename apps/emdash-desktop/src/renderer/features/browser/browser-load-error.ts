import type { BrowserLoadError } from '@shared/browser';

export function browserLoadErrorTitle(error: BrowserLoadError): string {
  const description = error.description.trim();
  if (description.length === 0) return 'Page failed to load';

  if (/^(err_|net::err_)/i.test(description)) return browserLoadErrorCodeLabel(description);
  return description;
}

export function browserLoadErrorCode(error: BrowserLoadError): string | null {
  const description = error.description.trim();
  if (/^(err_|net::err_)/i.test(description)) return browserLoadErrorCodeLabel(description);
  if (error.code === undefined) return null;
  return `Error ${error.code}`;
}

function browserLoadErrorCodeLabel(value: string): string {
  return value.replace(/^net::/i, '').toUpperCase();
}
