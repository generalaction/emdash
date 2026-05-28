import { describe, expect, it } from 'vitest';
import {
  makeAmpPluginContent,
  makeClaudeHookCommand,
  makeCodexHookCommand,
  makeCodexSessionStartHookCommand,
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

describe('makeCodexHookCommand', () => {
  it('posts native Codex hook events to the Emdash hook server on POSIX', () => {
    const content = makeCodexHookCommand('idle_prompt', { platform: 'darwin' });

    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('X-Emdash-Token');
    expect(content).toContain('X-Emdash-Pty-Id');
    expect(content).toContain('INPUT="${1:-$(cat)}"');
    expect(content).toContain('X-Emdash-Event-Type: notification');
    expect(content).toContain('-d @-');
  });

  it('posts native Codex hook events to the Emdash hook server on Windows', () => {
    const content = makeCodexHookCommand('permission_prompt', { platform: 'win32' });
    const script = decodeWindowsHookCommand(content);

    expect(content).toContain('cmd.exe');
    expect(content).toContain('powershell.exe');
    expect(content).toContain('EMDASH_HOOK_PORT');
    expect(content).toContain('-EncodedCommand');
    expect(script).toContain('X-Emdash-Token');
    expect(script).toContain('X-Emdash-Pty-Id');
    expect(script).toContain('$payload = \'{"notification_type":"permission_prompt"}\'');
    expect(script).toContain("'X-Emdash-Event-Type' = 'notification'");
  });
});

describe('makeCodexSessionStartHookCommand', () => {
  it('forwards Codex SessionStart hook stdin or argv to the Emdash hook server', () => {
    const content = makeCodexSessionStartHookCommand({ platform: 'darwin' });

    expect(content).toContain('INPUT="${1:-$(cat)}"');
    expect(content).toContain('X-Emdash-Event-Type: session-start');
    expect(content).toContain('-d @-');
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
