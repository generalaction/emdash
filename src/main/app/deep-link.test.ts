import { describe, expect, it } from 'vitest';
import { findDeepLinkInArgv } from './deep-link-utils';

describe('findDeepLinkInArgv', () => {
  it('finds emdash share links in argv', () => {
    expect(findDeepLinkInArgv(['electron', '.', 'emdash://share/skills/abc123'], 'emdash')).toBe(
      'emdash://share/skills/abc123'
    );
  });

  it('ignores non-deep-link args', () => {
    expect(
      findDeepLinkInArgv(['electron', '.', 'https://share.emdash.sh/skills/abc123'], 'emdash')
    ).toBe(null);
  });
});
