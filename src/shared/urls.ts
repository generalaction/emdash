export const EMDASH_RELEASES_URL = 'https://github.com/generalaction/emdash/releases';
export const EMDASH_DOCS_URL = 'https://docs.emdash.sh';
export function normalizeUrl(u: string): string {
  try {
    const re = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/\S*)?)/i;
    const m = u.match(re);
    if (!m) return '';
    const url = new URL(m[1]);
    url.hostname = 'localhost';
    return url.toString();
  } catch {
    return '';
  }
}
