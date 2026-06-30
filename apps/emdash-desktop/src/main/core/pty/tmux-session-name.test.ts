import { describe, expect, it } from 'vitest';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import {
  buildTmuxShellLine,
  decodeTmuxSessionName,
  makeTmuxSessionName,
} from './tmux-session-name';

describe('buildTmuxShellLine', () => {
  it('enables tmux mouse scrolling and deep history before attach', () => {
    const result = buildTmuxShellLine('agent-session', 'exec /bin/zsh -il');

    expect(result).toMatch(/^\/bin\/sh -c /);
    expect(result).toContain('tmux has-session -t \\"agent-session\\"');
    expect(result).toContain(
      'tmux -u new-session -d -s \\"agent-session\\" \\"exec /bin/zsh -il\\"'
    );
    expect(result).toContain('tmux set-option -t \\"agent-session\\" mouse on');
    expect(result).toContain('tmux set-option -t \\"agent-session\\" history-limit 100000');
    expect(result).toContain('tmux -u attach-session -t \\"agent-session\\"');
    expect(result.indexOf('mouse on')).toBeLessThan(result.indexOf('attach-session'));
    expect(result.indexOf('history-limit')).toBeLessThan(result.indexOf('attach-session'));
  });

  it('pre-declares the terminal capabilities before attach so tmux skips the probe reply', () => {
    const result = buildTmuxShellLine('agent-session', 'exec /bin/zsh -il');

    // Server option (no `-t`), appended (`-a`), keyed by TERM, includes RGB/256.
    expect(result).toContain('tmux set-option -as terminal-features ,xterm-256color:RGB:256:');
    expect(result.indexOf('terminal-features')).toBeLessThan(result.indexOf('attach-session'));
  });
});

describe('decodeTmuxSessionName', () => {
  it('round-trips a PTY session id through make/decode', () => {
    const sessionId = makePtySessionId('proj-1', 'task-2', 'conv-3');
    const name = makeTmuxSessionName(sessionId);
    expect(decodeTmuxSessionName(name)).toBe(sessionId);
  });

  it('returns null for a name without the emdash- prefix', () => {
    expect(decodeTmuxSessionName('other-abc')).toBeNull();
  });

  it('returns null for the bare prefix', () => {
    expect(decodeTmuxSessionName('emdash-')).toBeNull();
  });

  it('returns null when the suffix does not re-encode to the same name', () => {
    // Contains characters that base64url-decode lossily, so the round-trip guard rejects it.
    expect(decodeTmuxSessionName('emdash-not*base64url')).toBeNull();
  });
});
