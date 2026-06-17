import { describe, expect, it } from 'vitest';
import { selectMultiplexer } from './select';

const BOTH = { boo: true, tmux: true };

describe('selectMultiplexer', () => {
  it('prefers boo for agent sessions when detected', () => {
    expect(selectMultiplexer('agent', BOTH)?.id).toBe('boo');
    expect(selectMultiplexer('agent', { boo: false, tmux: true })?.id).toBe('tmux');
    expect(selectMultiplexer('agent', { boo: false, tmux: false })).toBeNull();
  });

  it('uses tmux only for terminal sessions and ignores override', () => {
    expect(selectMultiplexer('terminal', BOTH)?.id).toBe('tmux');
    expect(selectMultiplexer('terminal', BOTH, 'boo')?.id).toBe('tmux');
    expect(selectMultiplexer('terminal', { boo: true, tmux: false })).toBeNull();
  });

  it('honors the agent override when the requested backend is detected', () => {
    expect(selectMultiplexer('agent', BOTH, 'tmux')?.id).toBe('tmux');
    expect(selectMultiplexer('agent', BOTH, 'boo')?.id).toBe('boo');
  });

  it('falls through normal agent selection when the override is not detected', () => {
    expect(selectMultiplexer('agent', { boo: true, tmux: false }, 'tmux')?.id).toBe('boo');
  });
});
