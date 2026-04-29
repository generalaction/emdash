import { describe, expect, it, vi } from 'vitest';
import { makeCodexNotifyCommand } from './agent-notify-command';

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
