export const EMDASH_RELEASES_URL = 'https://github.com/generalaction/emdash/releases';
export const EMDASH_WEBSITE_URL = 'https://www.emdash.sh/';
export const EMDASH_DOWNLOAD_URL = 'https://www.emdash.sh/download';

type UTMOptions = {
  source?: string;
  medium?: string;
  campaign: string;
  content?: string;
  term?: string;
};

export function withUtmParams(url: string, utm: UTMOptions): string {
  const trackedUrl = new URL(url);
  trackedUrl.searchParams.set('utm_campaign', utm.campaign);

  if (utm.source) trackedUrl.searchParams.set('utm_source', utm.source);
  if (utm.medium) trackedUrl.searchParams.set('utm_medium', utm.medium);
  if (utm.content) trackedUrl.searchParams.set('utm_content', utm.content);
  if (utm.term) trackedUrl.searchParams.set('utm_term', utm.term);

  return trackedUrl.toString();
}

export function getEmdashV1BetaUrl(utmContent?: string): string {
  return withUtmParams(EMDASH_DOWNLOAD_URL, {
    source: 'emdash-app',
    medium: 'in-app',
    campaign: 'v0-banner-link',
    content: utmContent,
  });
}

export const EMDASH_DOCS_URL = 'https://emdash.sh/docs';
