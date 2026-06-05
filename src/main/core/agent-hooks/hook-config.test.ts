import * as toml from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { MemoryFs } from '@main/core/fs/test-helpers/memory-fs';
import { HookConfigWriter } from './hook-config';

const mockResolveCommandPath = vi.hoisted(() => vi.fn());

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: mockResolveCommandPath,
}));

function makeExecutionContext(): IExecutionContext {
  return {
    supportsLocalSpawn: false,
    exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

function makeWriter(fs: MemoryFs, userFs = new MemoryFs()): HookConfigWriter {
  return new HookConfigWriter(fs, makeExecutionContext(), { userFs, platform: 'darwin' });
}

describe('HookConfigWriter', () => {
  beforeEach(() => {
    mockResolveCommandPath.mockReset();
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/pi');
  });

  it('writes the Pi lifecycle extension and ignores it in git', async () => {
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain("pi.on('agent_end'");
    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain(
      "process.once('uncaughtException'"
    );
    expect(fs.files.get('.pi/extensions/emdash-hook.ts')).toContain("'X-Emdash-Event-Type'");
    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/emdash-hook.ts\n');
  });

  it('does not duplicate the Pi gitignore entry', async () => {
    const fs = new MemoryFs();
    fs.files.set('.gitignore', '.pi/extensions/emdash-hook.ts\n');
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.get('.gitignore')).toBe('.pi/extensions/emdash-hook.ts\n');
  });

  it('skips the Pi extension when pi is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('pi');

    expect(fs.files.has('.pi/extensions/emdash-hook.ts')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes Codex hooks to the global user config and does not update gitignore', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/codex');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('codex');

    expect(wroteConfig).toBe(true);
    expect(fs.files.has('.codex/hooks.json')).toBe(false);
    expect(fs.files.has('.codex/config.toml')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);

    const config = JSON.parse(userFs.files.get('.codex/hooks.json')!);
    expect(config.hooks.Stop[0].hooks[0].command).toContain('{"notification_type":"idle_prompt"}');
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain(
      '{"notification_type":"permission_prompt"}'
    );
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('session-start');
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('INPUT="${1:-$(cat)}"');
    expect(config.hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Pty-Id');
  });

  it('preserves unrelated Codex hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/codex');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    userFs.files.set(
      '.codex/hooks.json',
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'echo user hook' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
        },
      })
    );
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('codex');

    const config = JSON.parse(userFs.files.get('.codex/hooks.json')!);
    expect(config.hooks.Stop).toHaveLength(2);
    expect(config.hooks.Stop[0].hooks[0].command).toBe('echo user hook');
    expect(config.hooks.Stop[1].hooks[0].command).toContain('{"notification_type":"idle_prompt"}');
  });

  it('writes Grok hooks to the global user hooks directory', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/grok');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('grok');

    expect(wroteConfig).toBe(true);
    expect(fs.files.has('.grok/hooks/emdash.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);

    const config = JSON.parse(userFs.files.get('.grok/hooks/emdash.json')!);
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('X-Emdash-Event-Type: session');
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('"session_id":"');
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('$GROK_SESSION_ID');
    expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'X-Emdash-Event-Type: start'
    );
    expect(config.hooks.PreToolUse[0].hooks[0].command).toContain('X-Emdash-Event-Type: start');
    expect(config.hooks.PostToolUse[0].hooks[0].command).toContain('X-Emdash-Event-Type: start');
    expect(config.hooks.PostToolUseFailure[0].hooks[0].command).toContain(
      'X-Emdash-Event-Type: start'
    );
    expect(config.hooks.Notification[0].hooks[0].command).toContain(
      'X-Emdash-Event-Type: notification'
    );
    expect(config.hooks.Notification[0].hooks[0].command).toContain('-d @-');
    expect(config.hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.StopFailure[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.SessionEnd[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
  });

  it('preserves unrelated Grok hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/grok');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    userFs.files.set(
      '.grok/hooks/emdash.json',
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'echo user hook' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
        },
      })
    );
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('grok');

    const config = JSON.parse(userFs.files.get('.grok/hooks/emdash.json')!);
    expect(config.hooks.Stop).toHaveLength(2);
    expect(config.hooks.Stop[0].hooks[0].command).toBe('echo user hook');
    expect(config.hooks.Stop[1].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
  });

  it('skips Grok hooks when grok is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('grok');

    expect(userFs.files.has('.grok/hooks/emdash.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes Kimi hooks to the current and legacy global user config TOML paths', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/kimi');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('kimi');

    expect(wroteConfig).toBe(true);
    expect(fs.files.has('.kimi-code/config.toml')).toBe(false);
    expect(fs.files.has('.kimi/config.toml')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);

    const config = toml.parse(userFs.files.get('.kimi-code/config.toml')!) as Record<
      string,
      unknown
    >;
    const legacyConfig = toml.parse(userFs.files.get('.kimi/config.toml')!) as Record<
      string,
      unknown
    >;
    const hooks = config.hooks as Record<string, string>[];
    expect(legacyConfig.hooks).toEqual(config.hooks);
    expect(hooks.find((hook) => hook.event === 'SessionStart')?.command).toContain(
      'X-Emdash-Event-Type: session'
    );
    expect(hooks.find((hook) => hook.event === 'UserPromptSubmit')?.command).toContain(
      'X-Emdash-Event-Type: start'
    );
    expect(hooks.find((hook) => hook.event === 'PostToolUse')?.command).toContain(
      'X-Emdash-Event-Type: start'
    );
    expect(hooks.find((hook) => hook.event === 'Notification')?.command).toContain(
      'X-Emdash-Event-Type: notification'
    );
    expect(hooks.find((hook) => hook.event === 'Stop')?.command).toContain(
      'X-Emdash-Event-Type: stop'
    );
  });

  it('preserves unrelated Kimi hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/kimi');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    userFs.files.set(
      '.kimi-code/config.toml',
      toml.stringify({
        model: 'moonshot-v1',
        hooks: [
          { event: 'Stop', command: 'echo user hook' },
          { event: 'Stop', command: 'echo $EMDASH_HOOK_PORT' },
        ],
      })
    );
    userFs.files.set(
      '.kimi/config.toml',
      toml.stringify({
        model: 'moonshot-v1',
        hooks: [
          { event: 'Stop', command: 'echo user hook' },
          { event: 'Stop', command: 'echo $EMDASH_HOOK_PORT' },
        ],
      })
    );
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('kimi');

    const config = toml.parse(userFs.files.get('.kimi-code/config.toml')!) as Record<
      string,
      unknown
    >;
    const legacyConfig = toml.parse(userFs.files.get('.kimi/config.toml')!) as Record<
      string,
      unknown
    >;
    const hooks = config.hooks as Record<string, string>[];
    expect(config.model).toBe('moonshot-v1');
    expect(legacyConfig.hooks).toEqual(config.hooks);
    expect(hooks.filter((hook) => hook.event === 'Stop')).toHaveLength(2);
    expect(hooks[0]).toEqual({ event: 'Stop', command: 'echo user hook' });
    expect(hooks.filter((hook) => hook.event === 'Stop').at(-1)?.command).toContain(
      'X-Emdash-Event-Type: stop'
    );
  });

  it('writes Kimi hooks without probing PATH because the PTY command may still resolve', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('kimi');

    expect(wroteConfig).toBe(true);
    expect(userFs.files.has('.kimi-code/config.toml')).toBe(true);
    expect(userFs.files.has('.kimi/config.toml')).toBe(true);
    expect(fs.files.has('.gitignore')).toBe(false);
    expect(mockResolveCommandPath).not.toHaveBeenCalledWith('kimi', expect.anything());
  });

  it('leaves unparsable Kimi user configs unchanged', async () => {
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    userFs.files.set('.kimi-code/config.toml', '[[hooks]\nnot valid');
    userFs.files.set('.kimi/config.toml', '[[hooks]\nnot valid');
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('kimi');

    expect(wroteConfig).toBe(false);
    expect(userFs.files.get('.kimi-code/config.toml')).toBe('[[hooks]\nnot valid');
    expect(userFs.files.get('.kimi/config.toml')).toBe('[[hooks]\nnot valid');
  });

  it('writes Qwen hooks to project settings and ignores the settings file in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/qwen');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    const wroteConfig = await writer.writeForProvider('qwen');

    expect(wroteConfig).toBe(true);
    const config = JSON.parse(fs.files.get('.qwen/settings.json')!);
    expect(config.hooks.UserPromptSubmit).toBeUndefined();
    expect(config.hooks.PreToolUse).toBeUndefined();
    expect(config.hooks.PostToolUse).toBeUndefined();
    expect(config.hooks.PostToolUseFailure).toBeUndefined();
    expect(config.hooks.Notification).toBeUndefined();
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain(
      'X-Emdash-Event-Type: notification'
    );
    expect(config.hooks.PermissionRequest[0].hooks[0].command).toContain('-d @-');
    expect(config.hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.SessionEnd[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(fs.files.get('.gitignore')).toBe('.qwen/settings.json\n');
  });

  it('preserves unrelated Qwen hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/qwen');
    const fs = new MemoryFs();
    fs.files.set(
      '.qwen/settings.json',
      JSON.stringify({
        disableAllHooks: false,
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'echo user hook' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
        },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('qwen');

    const config = JSON.parse(fs.files.get('.qwen/settings.json')!);
    expect(config.disableAllHooks).toBe(false);
    expect(config.hooks.Stop).toHaveLength(2);
    expect(config.hooks.Stop[0].hooks[0].command).toBe('echo user hook');
    expect(config.hooks.Stop[1].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
  });

  it('skips Qwen hooks when qwen is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('qwen');

    expect(fs.files.has('.qwen/settings.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes Devin stop and permission hooks and ignores the project hooks file in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/devin');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    const wroteConfig = await writer.writeForProvider('devin');

    expect(wroteConfig).toBe(true);
    const hooks = JSON.parse(fs.files.get('.devin/hooks.v1.json')!);
    expect(hooks.UserPromptSubmit).toBeUndefined();
    expect(hooks.PreToolUse).toBeUndefined();
    expect(hooks.PostToolUse).toBeUndefined();
    expect(hooks.PostCompaction).toBeUndefined();
    expect(hooks.PermissionRequest[0].hooks[0].command).toContain(
      '{"notification_type":"permission_prompt"}'
    );
    expect(hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(hooks.SessionEnd[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(fs.files.get('.gitignore')).toBe('.devin/hooks.v1.json\n');
  });

  it('preserves unrelated Devin hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/devin');
    const fs = new MemoryFs();
    fs.files.set(
      '.devin/hooks.v1.json',
      JSON.stringify({
        Stop: [
          { hooks: [{ type: 'command', command: 'echo user hook' }] },
          { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
        ],
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('devin');

    const hooks = JSON.parse(fs.files.get('.devin/hooks.v1.json')!);
    expect(hooks.Stop).toHaveLength(2);
    expect(hooks.Stop[0].hooks[0].command).toBe('echo user hook');
    expect(hooks.Stop[1].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
  });

  it('skips Devin hooks when devin is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('devin');

    expect(fs.files.has('.devin/hooks.v1.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('removes only the legacy Emdash Codex notify key from project-local config', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/codex');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    fs.files.set(
      '.codex/config.toml',
      toml.stringify({
        model: 'gpt-5.2',
        notify: [
          'bash',
          '-c',
          'curl -sf -X POST ' +
            "-H 'Content-Type: application/json' " +
            '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
            '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
            '-H "X-Emdash-Event-Type: notification" ' +
            '-d "$1" ' +
            '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
          '_',
        ],
      })
    );
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('codex');

    const config = toml.parse(fs.files.get('.codex/config.toml')!) as Record<string, unknown>;
    expect(config.model).toBe('gpt-5.2');
    expect(config.notify).toBeUndefined();
  });

  it('writes Copilot CLI hooks and ignores the project hook file in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/copilot');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    const wroteConfig = await writer.writeForProvider('copilot');

    expect(wroteConfig).toBe(true);
    const config = JSON.parse(fs.files.get('.github/hooks/emdash.json')!);
    expect(config.version).toBe(1);
    expect(config.hooks.notification).toHaveLength(0);
    expect(config.hooks.agentStop[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.sessionStart[0].command).toContain('X-Emdash-Event-Type: session');
    expect(config.hooks.permissionRequest[0].command).toContain(
      '{"notification_type":"permission_prompt"}'
    );
    expect(fs.files.get('.gitignore')).toBe('.github/hooks/emdash.json\n');
  });

  it('preserves unrelated Copilot hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/copilot');
    const fs = new MemoryFs();
    fs.files.set(
      '.github/hooks/emdash.json',
      JSON.stringify({
        version: 1,
        hooks: {
          notification: [
            { type: 'command', command: 'echo user hook' },
            { type: 'command', command: 'echo $EMDASH_HOOK_PORT' },
          ],
        },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('copilot');

    const config = JSON.parse(fs.files.get('.github/hooks/emdash.json')!);
    expect(config.hooks.notification).toHaveLength(1);
    expect(config.hooks.notification[0].command).toBe('echo user hook');
    expect(config.hooks.agentStop[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.permissionRequest[0].command).toContain(
      '{"notification_type":"permission_prompt"}'
    );
  });

  it('skips Copilot hooks when copilot is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('copilot');

    expect(fs.files.has('.github/hooks/emdash.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes Droid notification and stop hooks and ignores the settings file in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/droid');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('droid');

    const config = JSON.parse(fs.files.get('.factory/settings.json')!);
    expect(config.hooks.Notification[0].hooks[0].command).toContain(
      'X-Emdash-Event-Type: notification'
    );
    expect(config.hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.Stop[0].hooks[0].command).toContain('X-Emdash-Pty-Id');
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain('X-Emdash-Event-Type: session');
    expect(fs.files.get('.gitignore')).toBe('.factory/settings.json\n');
  });

  it('preserves unrelated Droid hooks while replacing Emdash-managed entries', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/droid');
    const fs = new MemoryFs();
    fs.files.set(
      '.factory/settings.json',
      JSON.stringify({
        hooks: {
          Notification: [
            { hooks: [{ type: 'command', command: 'echo user notification hook' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
          Stop: [
            { hooks: [{ type: 'command', command: 'echo user hook' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
        },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('droid');

    const config = JSON.parse(fs.files.get('.factory/settings.json')!);
    expect(config.hooks.Notification).toHaveLength(2);
    expect(config.hooks.Notification[0].hooks[0].command).toBe('echo user notification hook');
    expect(config.hooks.Notification[1].hooks[0].command).toContain(
      'X-Emdash-Event-Type: notification'
    );
    expect(config.hooks.Stop).toHaveLength(2);
    expect(config.hooks.Stop[0].hooks[0].command).toBe('echo user hook');
    expect(config.hooks.Stop[1].hooks[0].command).toContain('X-Emdash-Event-Type: stop');
  });

  it('skips Droid hooks when droid is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('droid');

    expect(fs.files.has('.factory/settings.json')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('still reports Codex hooks available when legacy notify cleanup fails', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/codex');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    fs.files.set(
      '.codex/config.toml',
      toml.stringify({
        notify: [
          'bash',
          '-c',
          'curl -sf -X POST ' +
            "-H 'Content-Type: application/json' " +
            '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
            '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
            '-H "X-Emdash-Event-Type: notification" ' +
            '-d "$1" ' +
            '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
          '_',
        ],
      })
    );
    const originalWrite = fs.write.bind(fs);
    fs.write = vi.fn(async (path, content) => {
      if (path === '.codex/config.toml') {
        throw new Error('read-only config');
      }
      return originalWrite(path, content);
    });
    const writer = makeWriter(fs, userFs);

    const wroteConfig = await writer.writeForProvider('codex');

    expect(wroteConfig).toBe(true);
    expect(userFs.files.get('.codex/hooks.json')).toContain('PermissionRequest');
  });

  it('keeps user-managed Codex notify values in project-local config', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/codex');
    const fs = new MemoryFs();
    const userFs = new MemoryFs();
    fs.files.set(
      '.codex/config.toml',
      toml.stringify({
        notify: ['bash', '-c', 'echo user notify'],
      })
    );
    const writer = makeWriter(fs, userFs);

    await writer.writeForProvider('codex');

    const config = toml.parse(fs.files.get('.codex/config.toml')!) as Record<string, unknown>;
    expect(config.notify).toEqual(['bash', '-c', 'echo user notify']);
  });

  it('writes the OpenCode notifications plugin and ignores it in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/opencode');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.get('.opencode/plugins/emdash-notifications.js')).toContain(
      'EmdashNotifications'
    );
    expect(fs.files.get('.opencode/plugins/emdash-notifications.js')).toContain(
      "event.type === 'session.idle'"
    );
    expect(fs.files.get('.gitignore')).toBe('.opencode/plugins/emdash-notifications.js\n');
  });

  it('does not duplicate the OpenCode gitignore entry', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/opencode');
    const fs = new MemoryFs();
    fs.files.set('.gitignore', '.opencode/plugins/emdash-notifications.js\n');
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.get('.gitignore')).toBe('.opencode/plugins/emdash-notifications.js\n');
  });

  it('skips the OpenCode plugin when opencode is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('opencode');

    expect(fs.files.has('.opencode/plugins/emdash-notifications.js')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });

  it('writes the Amp lifecycle plugin and ignores it in git', async () => {
    mockResolveCommandPath.mockResolvedValue('/usr/local/bin/amp');
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('amp');

    expect(fs.files.get('.amp/plugins/emdash-hook.ts')).toContain("amp.on('agent.start'");
    expect(fs.files.get('.amp/plugins/emdash-hook.ts')).toContain(
      '@i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now'
    );
    expect(fs.files.get('.amp/plugins/emdash-hook.ts')).toContain("amp.on('agent.end'");
    expect(fs.files.get('.amp/plugins/emdash-hook.ts')).toContain('X-Emdash-Pty-Id');
    expect(fs.files.get('.gitignore')).toBe('.amp/plugins/emdash-hook.ts\n');
  });

  it('skips the Amp plugin when amp is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('amp');

    expect(fs.files.has('.amp/plugins/emdash-hook.ts')).toBe(false);
    expect(fs.files.has('.gitignore')).toBe(false);
  });
});
