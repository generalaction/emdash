import { describe, expect, it } from 'vitest';
import { makeCodexHookCommand, makeOpenCodePluginContent } from './agent-notify-command';

describe('makeCodexHookCommand', () => {
  it('posts native Codex hook events to the Emdash hook server', () => {
    const content = makeCodexHookCommand('idle_prompt');

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('X-Emdash-Token');
    expect(content).toContain('X-Emdash-Pty-Id');
    expect(content).toContain('{"notification_type":"idle_prompt"}');
  });
});

describe('makeOpenCodePluginContent', () => {
  it('posts OpenCode session events to the Emdash hook server', () => {
    const content = makeOpenCodePluginContent();

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain("event.type === 'session.idle'");
    expect(content).toContain("event.type === 'session.error'");
    expect(content).toContain("'X-Emdash-Event-Type': payload.type");
  });
});
