export const EMDASH_RELEASES_URL = 'https://github.com/generalaction/emdash/releases';
export const EMDASH_DOCS_URL = 'https://docs.emdash.sh';
export const EMDASH_DOWNLOAD_URL = 'https://www.emdash.sh/download';

export function getEmdashStableDownloadUrl(utmContent?: string): string {
  const url = new URL(EMDASH_DOWNLOAD_URL);
  url.searchParams.set('utm_campaign', 'v1-beta-deprecation-banner');
  url.searchParams.set('utm_source', 'emdash-app');
  url.searchParams.set('utm_medium', 'in-app');

  if (utmContent) {
    url.searchParams.set('utm_content', utmContent);
  }

  return url.toString();
}
