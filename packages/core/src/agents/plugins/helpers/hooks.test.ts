import { describe, expect, it } from 'vitest';
import {
  EMDASH_MARKER,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  makeWindowsPowerShellHookCommand,
} from './hooks';

describe('hook command helpers', () => {
  it('builds POSIX stdin hook commands', () => {
    expect(makeStdinHookCommand('stop', { platform: 'linux' })).toBe(
      'curl -sf -X POST ' +
        '-H "Content-Type: application/json" ' +
        '-H "X-Emdash-Token: $EMDASH_HOOK_NONCE" ' +
        '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
        '-H "X-Emdash-Event-Type: stop" ' +
        '-d @- ' +
        '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
    );
  });

  it('builds Windows hook commands without a quoted cmd.exe body', () => {
    const command = makeNotificationHookCommand('idle_prompt', { platform: 'win32' });

    expect(command).toMatch(
      /^cmd\.exe \/d \/c set EMDASH_HOOK_MARKER=EMDASH_HOOK_PORT&&powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/]+=*$/
    );
    expect(command).toContain(EMDASH_MARKER);
    expect(command).not.toContain('/c "');
    expect(command).not.toContain('& powershell.exe');
  });

  it('does not redirect to NUL (avoids creating a stray NUL file under non-cmd shells)', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(command).not.toContain('>NUL');
    expect(command).not.toContain('>nul');
  });

  it('keeps the Emdash marker visible to hook config cleanup without PowerShell args', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(
      command.startsWith(`cmd.exe /d /c set EMDASH_HOOK_MARKER=${EMDASH_MARKER}&&powershell.exe `)
    ).toBe(true);
  });
});
