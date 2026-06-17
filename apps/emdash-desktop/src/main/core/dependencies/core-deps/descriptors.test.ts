import { describe, expect, it } from 'vitest';
import { CORE_DEPENDENCIES } from './descriptors';

describe('CORE_DEPENDENCIES', () => {
  it('registers boo as a managed core dependency with an installer', () => {
    const boo = CORE_DEPENDENCIES.find((d) => d.id === 'boo');
    expect(boo).toBeDefined();
    expect(boo?.category).toBe('core');
    expect(boo?.commands).toContain('boo');
    expect(boo?.installCommands?.macos?.[0]?.method).toBe('curl');
  });

  it('registers tmux as a detection-only core dependency (no install commands)', () => {
    const tmux = CORE_DEPENDENCIES.find((d) => d.id === 'tmux');
    expect(tmux?.category).toBe('core');
    expect(tmux?.versionArgs).toEqual(['-V']);
    expect(tmux?.installCommands).toBeUndefined();
  });
});
