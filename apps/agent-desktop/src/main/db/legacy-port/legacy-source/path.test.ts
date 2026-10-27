import { describe, expect, it } from 'vitest';
import { resolveLegacyUserDataPathCandidates } from './path';

describe('resolveLegacyUserDataPathCandidates', () => {
  it('checks the capitalized legacy config directory after lowercase agent on Linux', () => {
    expect(resolveLegacyUserDataPathCandidates('/home/user/.config/agent', 'linux')).toEqual([
      '/home/user/.config/agent',
      '/home/user/.config/Agent',
    ]);
  });

  it('does not add a capitalized fallback outside Linux', () => {
    expect(
      resolveLegacyUserDataPathCandidates('/Users/user/Library/Application Support/agent', 'darwin')
    ).toEqual(['/Users/user/Library/Application Support/agent']);
  });

  it('does not duplicate paths when the configured directory is already capitalized', () => {
    expect(resolveLegacyUserDataPathCandidates('/home/user/.config/Agent', 'linux')).toEqual([
      '/home/user/.config/Agent',
    ]);
  });
});
