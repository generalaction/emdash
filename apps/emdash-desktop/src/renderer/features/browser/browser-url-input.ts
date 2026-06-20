import { BROWSER_DEFAULT_URL } from '@shared/browser';

export function browserUrlInputText(url: string): string {
  return url === BROWSER_DEFAULT_URL ? '' : url;
}

export type BrowserUrlDisplayParts =
  | { kind: 'empty' }
  | { kind: 'plain'; text: string }
  | { kind: 'web'; prefix: string; remainder: string };

const WEB_URL_PREFIX_PATTERN = /^(https?:\/\/|file:\/\/)([\s\S]*)$/;

export function splitBrowserUrlDisplay(text: string): BrowserUrlDisplayParts {
  if (text.length === 0) return { kind: 'empty' };

  const match = text.match(WEB_URL_PREFIX_PATTERN);
  if (match) {
    return { kind: 'web', prefix: match[1], remainder: match[2] };
  }

  return { kind: 'plain', text };
}
