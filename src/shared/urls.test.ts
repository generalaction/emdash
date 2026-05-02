import { describe, expect, it } from 'vitest';
import { getEmdashStableDownloadUrl } from './urls';

describe('getEmdashStableDownloadUrl', () => {
  it('builds the stable download URL with app banner attribution', () => {
    expect(getEmdashStableDownloadUrl('sidebar-deprecation-notice')).toBe(
      'https://www.emdash.sh/download?utm_campaign=v1-beta-deprecation-banner&utm_source=emdash-app&utm_medium=in-app&utm_content=sidebar-deprecation-notice'
    );
  });
});
