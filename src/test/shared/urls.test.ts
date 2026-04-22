import { describe, expect, it } from 'vitest';
import { EMDASH_DOWNLOAD_URL, getEmdashV1BetaUrl, withUtmParams } from '../../shared/urls';

describe('shared urls', () => {
  it('builds tracked beta download urls with app attribution params', () => {
    const url = new URL(getEmdashV1BetaUrl('project-header-badge'));

    expect(url.origin + url.pathname).toBe(EMDASH_DOWNLOAD_URL);
    expect(url.searchParams.get('utm_source')).toBe('emdash-app');
    expect(url.searchParams.get('utm_medium')).toBe('in-app');
    expect(url.searchParams.get('utm_campaign')).toBe('v0-banner-link');
    expect(url.searchParams.get('utm_content')).toBe('project-header-badge');
  });

  it('preserves existing query params when appending UTMs', () => {
    const url = new URL(
      withUtmParams('https://www.emdash.sh/download?foo=bar', { campaign: 'test-campaign' })
    );

    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('utm_campaign')).toBe('test-campaign');
  });
});
