import { describe, expect, it } from 'vitest';
import { makeOpenCodePluginContent } from './agent-notify-command';

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
