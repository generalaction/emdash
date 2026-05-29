import { describe, expect, it } from 'vitest';
import {
  makeAmpPluginContent,
  makeClaudeHookCommand,
  makeCodexNotifyHookCommand,
  makeCodexNotifyPowerShellContent,
  makeCodexNotifyScriptContent,
  makeOpenCodePluginContent,
} from './agent-notify-command';

function decodeWindowsHookCommand(command: string): string {
  const encodedScript = command.match(/-EncodedCommand ([^"]+)/)?.[1];
  return Buffer.from(encodedScript ?? '', 'base64').toString('utf16le');
}

describe('makeClaudeHookCommand', () => {
  it('forwards Claude hook stdin to the Emdash hook server on POSIX', () => {
    const content = makeClaudeHookCommand('stop', { platform: 'darwin' });

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('X-Emdash-Token');
    expect(content).toContain('X-Emdash-Pty-Id');
    expect(content).toContain('X-Emdash-Event-Type: stop');
    expect(content).toContain('-d @-');
  });

  it('forwards Claude hook stdin to the Emdash hook server on Windows', () => {
    const content = makeClaudeHookCommand('stop', { platform: 'win32' });
    const script = decodeWindowsHookCommand(content);

    expect(content).toContain('cmd.exe');
    expect(content).toContain('powershell.exe');
    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('-EncodedCommand');
    expect(script).toContain('$payload = [Console]::In.ReadToEnd()');
    expect(script).toContain('X-Emdash-Token');
    expect(script).toContain('X-Emdash-Pty-Id');
    expect(script).toContain("'X-Emdash-Event-Type' = 'stop'");
  });
});

describe('makeCodexNotifyHookCommand', () => {
  it('uses a short POSIX command that delegates native Codex hooks to the notify script', () => {
    const content = makeCodexNotifyHookCommand('$HOME/.emdash/hooks/codex-notify.sh', {
      platform: 'darwin',
    });

    expect(content).toBe('EMDASH_AGENT_ID=codex sh "$HOME/.emdash/hooks/codex-notify.sh"');
  });

  it('uses a short Windows command that delegates native Codex hooks to the notify script', () => {
    const content = makeCodexNotifyHookCommand('%USERPROFILE%\\.emdash\\hooks\\codex-notify.ps1', {
      platform: 'win32',
    });

    expect(content).toBe(
      'cmd.exe /d /c "set EMDASH_AGENT_ID=codex&& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""%USERPROFILE%\\.emdash\\hooks\\codex-notify.ps1"""'
    );
  });
});

describe('makeCodexNotifyScriptContent', () => {
  it('posts native Codex notification and SessionStart payloads to the Emdash hook server', () => {
    const content = makeCodexNotifyScriptContent();

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('X-Emdash-Token');
    expect(content).toContain('X-Emdash-Pty-Id');
    expect(content).toContain('X-Emdash-Agent-Id');
    expect(content).toContain('notification_type');
    expect(content).toContain('PermissionRequest');
    expect(content).toContain('input="${1:-$(cat)}"');
    expect(content).toContain('X-Emdash-Event-Type: session-start');
    expect(content).toContain('-d @-');
  });
});

describe('makeCodexNotifyPowerShellContent', () => {
  it('posts native Codex notification and SessionStart payloads to the Emdash hook server', () => {
    const content = makeCodexNotifyPowerShellContent();

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('X-Emdash-Token');
    expect(content).toContain('X-Emdash-Pty-Id');
    expect(content).toContain('X-Emdash-Agent-Id');
    expect(content).toContain('notification_type');
    expect(content).toContain('[Console]::In.ReadToEnd()');
    expect(content).toContain('PermissionRequest');
    expect(content).toContain("'X-Emdash-Event-Type' = $eventType");
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

describe('makeAmpPluginContent', () => {
  it('posts Amp agent lifecycle events to the Emdash hook server', () => {
    const content = makeAmpPluginContent();

    expect(content).toContain('@i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now');
    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain("amp.on('agent.start'");
    expect(content).toContain("amp.on('agent.end'");
    expect(content).toContain("'X-Emdash-Event-Type': eventType");
  });
});
