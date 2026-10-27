import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AGENT_MARKER,
  AGENT_HOOK_VERSION_MARKER,
  filterUserHooks,
  makeNotificationHookCommand,
  makeStdinHookCommand,
  makeWindowsPowerShellHookCommand,
} from './hooks';

describe('hook command helpers', () => {
  it('builds POSIX stdin hook commands', () => {
    expect(makeStdinHookCommand('stop', { platform: 'linux' })).toBe(
      `${AGENT_HOOK_VERSION_MARKER}; ` +
        'if [ -z "${AGENT_HOOK_PORT:-}" ] || [ -z "${AGENT_HOOK_NONCE:-}" ] || [ -z "${AGENT_PTY_ID:-}" ]; then exit 0; fi; ' +
        'curl -sf -X POST ' +
        '-H "Content-Type: application/json" ' +
        '-H "X-Agent-Token: $AGENT_HOOK_NONCE" ' +
        '-H "X-Agent-Pty-Id: $AGENT_PTY_ID" ' +
        '-H "X-Agent-Event-Type: stop" ' +
        '-d @- ' +
        '"http://127.0.0.1:$AGENT_HOOK_PORT/hook" || true'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'does not invoke curl when the Agent hook environment is absent',
    () => {
      const command = makeStdinHookCommand('stop', { platform: 'linux' });
      const shellCommand = `curl() { printf called; }; ${command}`;

      const outsideAgent = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        input: '{}',
      });
      const insideAgent = spawnSync('/bin/sh', ['-c', shellCommand], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          AGENT_HOOK_PORT: '1234',
          AGENT_HOOK_NONCE: 'nonce',
          AGENT_PTY_ID: 'pty-1',
        },
        input: '{}',
      });

      expect(outsideAgent.status).toBe(0);
      expect(outsideAgent.stdout).toBe('');
      expect(insideAgent.status).toBe(0);
      expect(insideAgent.stdout).toBe('called');
    }
  );

  it('builds Windows hook commands without a quoted cmd.exe body', () => {
    const command = makeNotificationHookCommand('idle_prompt', { platform: 'win32' });

    expect(command).toMatch(
      /^cmd\.exe \/d \/c set AGENT_HOOK_MARKER=AGENT_HOOK_CONFIG_VERSION=1 AGENT_HOOK_PORT&&powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/]+=*$/
    );
    expect(command).toContain(AGENT_MARKER);
    expect(command).not.toContain('/c "');
    expect(command).not.toContain('& powershell.exe');
  });

  it('emits no redirects (an outer shell parsing >NUL creates a stray NUL file)', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(command).not.toContain('>');
  });

  it.skipIf(process.platform === 'win32')(
    'returns safely quoted JSON when transport fails or routing variables are absent',
    () => {
      const response = {
        decision: 'stop',
        reason: "don't run $(printf injected) or `echo injected`",
      };
      const command = makeStdinHookCommand('stop', {
        platform: 'linux',
        stdoutJson: response,
      });
      for (const env of [
        {},
        { AGENT_HOOK_PORT: '1234', AGENT_HOOK_NONCE: 'nonce', AGENT_PTY_ID: 'pty-1' },
      ]) {
        const result = spawnSync(
          '/bin/sh',
          ['-c', `curl() { printf 'unexpected server response'; return 22; }; ${command}`],
          { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, input: '{}' }
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(response);
      }
    }
  );

  it('keeps the Agent markers visible to hook config cleanup without PowerShell args', () => {
    const command = makeWindowsPowerShellHookCommand('Write-Output "ok"');

    expect(
      command.startsWith(
        `cmd.exe /d /c set AGENT_HOOK_MARKER=${AGENT_HOOK_VERSION_MARKER} ${AGENT_MARKER}&&powershell.exe `
      )
    ).toBe(true);
    expect(filterUserHooks([{ command }])).toHaveLength(0);
  });
});
