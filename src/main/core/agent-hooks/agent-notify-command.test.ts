import { describe, expect, it, vi } from 'vitest';
import { makeCodexNotifyCommand, makeOpenCodePluginContent } from './agent-notify-command';

describe('makeCodexNotifyCommand', () => {
  it('writes the Windows notify script only once per script path', () => {
    const writeFile = vi.fn();
    const mkdir = vi.fn();
    const scriptPath = 'C:\\Temp\\emdash-codex-notify.ps1';

    makeCodexNotifyCommand({ platform: 'win32', scriptPath, mkdir, writeFile });
    makeCodexNotifyCommand({ platform: 'win32', scriptPath, mkdir, writeFile });

    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
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
