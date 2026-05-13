import { describe, expect, it } from 'vitest';
import { buildTmuxShellLine } from './tmux-session-name';

describe('buildTmuxShellLine', () => {
  it('enables tmux mouse scrolling and deep history before attach', () => {
    const result = buildTmuxShellLine('agent-session', 'exec /bin/zsh -il');

    expect(result).toMatch(/^\/bin\/sh -c /);
    expect(result).toContain('tmux has-session -t');
    expect(result).toContain('agent-session');
    expect(result).toContain('tmux new-session -d -s');
    expect(result).toContain('exec /bin/zsh -il');
    expect(result).toContain('mouse on');
    expect(result).toContain('history-limit 100000');
    expect(result).toContain('tmux attach-session -t');
    expect(result.indexOf('mouse on')).toBeLessThan(result.indexOf('attach-session'));
    expect(result.indexOf('history-limit')).toBeLessThan(result.indexOf('attach-session'));
  });
});
