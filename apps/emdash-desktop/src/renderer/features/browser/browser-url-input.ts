import { BROWSER_DEFAULT_URL } from '@shared/browser';

export function browserUrlInputText(url: string): string {
  return url === BROWSER_DEFAULT_URL ? '' : url;
}
