import { describe, expect, it } from 'vitest';
import { DEFAULT_REMOTE_NAME, selectPreferredRemote } from './remote-preference';

describe('selectPreferredRemote', () => {
  it('uses origin when setting is empty', () => {
    expect(selectPreferredRemote(undefined, [{ name: 'origin' }])).toBe(DEFAULT_REMOTE_NAME);
    expect(selectPreferredRemote('', [{ name: 'origin' }])).toBe(DEFAULT_REMOTE_NAME);
    expect(selectPreferredRemote('   ', [{ name: 'origin' }])).toBe(DEFAULT_REMOTE_NAME);
  });

  it('uses configured remote when it exists', () => {
    expect(selectPreferredRemote('upstream', [{ name: 'origin' }, { name: 'upstream' }])).toBe(
      'upstream'
    );
  });

  it('falls back to origin when configured remote does not exist', () => {
    expect(selectPreferredRemote('upstream', [{ name: 'origin' }])).toBe(DEFAULT_REMOTE_NAME);
  });

  it('falls back to origin even if no remotes are listed', () => {
    expect(selectPreferredRemote('upstream', [])).toBe(DEFAULT_REMOTE_NAME);
  });
});
