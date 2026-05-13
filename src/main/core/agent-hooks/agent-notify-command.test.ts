import { describe, expect, it } from 'vitest';
import { makeCodexNotifyCommand, makeOpenCodePluginContent } from './agent-notify-command';

describe('makeOpenCodePluginContent', () => {
  it('posts OpenCode session events to the Emdash hook server', () => {
    const content = makeOpenCodePluginContent();

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain("event.type === 'session.created'");
    expect(content).toContain('event.sessionID');
    expect(content).toContain("event.type === 'session.idle'");
    expect(content).toContain("event.type === 'session.error'");
    expect(content).toContain("'X-Emdash-Event-Type': payload.type");
  });
});

describe('makeCodexNotifyCommand', () => {
  it('uses the legacy Posix Codex notify command', () => {
    const command = makeCodexNotifyCommand({ platform: 'darwin' });

    expect(command).toEqual(['bash', '-c', expect.stringContaining('EMDASH_HOOK_PORT'), '_']);
    expect(command[2]).toContain('X-Emdash-Event-Type: notification');
  });
});
