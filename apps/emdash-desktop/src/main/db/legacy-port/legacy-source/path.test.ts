import { describe, expect, it } from 'vitest';
import { resolveLegacyUserDataPathCandidates } from './path';

describe('resolveLegacyUserDataPathCandidates', () => {
  it('checks the capitalized legacy config directory after lowercase emdash on Linux', () => {
    expect(resolveLegacyUserDataPathCandidates('/home/user/.config/emdash', 'linux')).toEqual([
      '/home/user/.config/emdash',
      '/home/user/.config/Emdash',
    ]);
  });

  it('does not add a capitalized fallback outside Linux', () => {
    expect(
      resolveLegacyUserDataPathCandidates(
        '/Users/user/Library/Application Support/emdash',
        'darwin'
      )
    ).toEqual(['/Users/user/Library/Application Support/emdash']);
  });

  it('does not duplicate paths when the configured directory is already capitalized', () => {
    expect(resolveLegacyUserDataPathCandidates('/home/user/.config/Emdash', 'linux')).toEqual([
      '/home/user/.config/Emdash',
    ]);
  });
});
