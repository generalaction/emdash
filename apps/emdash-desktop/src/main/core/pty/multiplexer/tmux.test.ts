import { describe, expect, it } from 'vitest';
import { tmuxBackend } from './tmux';

describe('tmuxBackend', () => {
  it('has id "tmux"', () => {
    expect(tmuxBackend.id).toBe('tmux');
  });

  it('makeSessionName matches the emdash-<base64url> scheme', () => {
    expect(tmuxBackend.makeSessionName('p:t:c')).toBe(
      `emdash-${Buffer.from('p:t:c', 'utf8').toString('base64url')}`
    );
  });

  it('buildAttachShellLine produces the has-session/new-session/attach tmux line', () => {
    const line = tmuxBackend.buildAttachShellLine('agent-session', 'exec /bin/zsh -il');
    expect(line).toMatch(/^\/bin\/sh -c /);
    expect(line).toContain('tmux has-session -t \\"agent-session\\"');
    expect(line).toContain('tmux -u attach-session -t \\"agent-session\\"');
  });
});
