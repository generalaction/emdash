import { describe, expect, it } from 'vitest';
import type { Remote } from './git';
import { selectPreferredPushRemote } from './git-utils';

const remotes: Remote[] = [
  { name: 'origin', url: 'https://github.com/myuser/repo' },
  { name: 'upstream', url: 'https://github.com/org/repo' },
];

describe('selectPreferredPushRemote', () => {
  it('returns pushRemote setting when it matches a known remote', () => {
    const result = selectPreferredPushRemote('origin', 'upstream', remotes);
    expect(result.name).toBe('origin');
  });

  it('falls back to fetchRemote when pushRemote is undefined', () => {
    const result = selectPreferredPushRemote(undefined, 'upstream', remotes);
    expect(result.name).toBe('upstream');
  });

  it('falls back to fetchRemote when pushRemote is empty string', () => {
    const result = selectPreferredPushRemote('', 'upstream', remotes);
    expect(result.name).toBe('upstream');
  });

  it('falls back to origin when both are undefined', () => {
    const result = selectPreferredPushRemote(undefined, undefined, remotes);
    expect(result.name).toBe('origin');
  });
});
