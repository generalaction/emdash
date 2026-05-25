import * as toml from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { MemoryFs } from '@main/core/fs/test-helpers/memory-fs';
import { HookConfigWriter } from './hook-config';

const mockResolveCommandPath = vi.hoisted(() => vi.fn());

function mockCursorCliPaths(): void {
  mockResolveCommandPath.mockImplementation(async (command: string) => {
    if (command === 'node') return '/usr/local/bin/node';
    if (command === 'cursor-agent' || command === 'agent') return '/usr/local/bin/cursor-agent';
    return '/usr/local/bin/pi';
  });
}

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

function readJson<T = Record<string, unknown>>(fs: MemoryFs, path: string): T {
  return JSON.parse(fs.files.get(path)! ?? '{}') as T;
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

  it('writes Cursor hook script, hooks.json, and gitignore entries', async () => {
    mockCursorCliPaths();
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    const wroteConfig = await writer.writeForProvider('cursor');

    expect(wroteConfig).toBe(true);
    expect(fs.files.get('.cursor/hooks/emdash-notify.cjs')).toContain('conversation_id');
    const config = readJson<{
      version: number;
      hooks: Record<string, { command: string }[]>;
    }>(fs, '.cursor/hooks.json');
    expect(config.version).toBe(1);
    expect(
      Object.fromEntries(
        Object.entries(config.hooks).map(([key, entries]) => [key, entries[0]?.command])
      )
    ).toMatchObject({
      stop: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs stop',
      beforeSubmitPrompt: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs start',
      afterAgentThought: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs start',
      preToolUse: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs start',
      beforeShellExecution: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs permission',
      beforeMCPExecution: '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs permission',
    });
    expect(config.hooks.afterAgentResponse).toBeUndefined();
    expect(config.hooks.afterFileEdit).toBeUndefined();
    expect(config.hooks.postToolUse).toBeUndefined();
    expect(fs.files.get('.gitignore')).toBe(
      '.cursor/hooks.json\n.cursor/hooks/emdash-notify.cjs\n.cursor/emdash-hook-session.json\n'
    );
  });

  it('writes the Cursor hook session file with connection details', async () => {
    mockCursorCliPaths();
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeCursorHookSession({
      port: 4242,
      token: 'secret-token',
      ptyId: 'cursor-conv-conversation-1',
      autoApprove: true,
    });

    expect(readJson(fs, '.cursor/emdash-hook-session.json')).toEqual({
      port: 4242,
      token: 'secret-token',
      activePtyId: 'cursor-conv-conversation-1',
      ptySessions: {
        'cursor-conv-conversation-1': { autoApprove: true },
      },
      cursorConversations: {},
    });
  });

  it('preserves Cursor conversation bindings when writing a new session', async () => {
    mockCursorCliPaths();
    const fs = new MemoryFs();
    fs.files.set(
      '.cursor/emdash-hook-session.json',
      JSON.stringify({
        port: 1111,
        token: 'old-token',
        activePtyId: 'cursor-conv-old',
        ptySessions: { 'cursor-conv-old': { autoApprove: false } },
        cursorConversations: { 'cursor-native-old': 'cursor-conv-old' },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeCursorHookSession({
      port: 4242,
      token: 'secret-token',
      ptyId: 'cursor-conv-new',
      autoApprove: true,
    });

    expect(readJson(fs, '.cursor/emdash-hook-session.json')).toEqual({
      port: 4242,
      token: 'secret-token',
      activePtyId: 'cursor-conv-new',
      ptySessions: {
        'cursor-conv-old': { autoApprove: false },
        'cursor-conv-new': { autoApprove: true },
      },
      cursorConversations: { 'cursor-native-old': 'cursor-conv-old' },
    });
  });

  it('preserves unrelated Cursor hooks while replacing Emdash-managed entries', async () => {
    mockCursorCliPaths();
    const fs = new MemoryFs();
    fs.files.set(
      '.cursor/hooks.json',
      JSON.stringify({
        version: 1,
        hooks: {
          stop: [
            { command: 'echo user stop hook' },
            { command: '.cursor/hooks/emdash-notify.js stop' },
            {
              command:
                'curl -sf -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" "http://127.0.0.1:$EMDASH_HOOK_PORT/hook"',
            },
          ],
        },
      })
    );
    const writer = makeWriter(fs);

    await writer.writeForProvider('cursor');

    const config = readJson<{ hooks: Record<string, { command: string }[]> }>(
      fs,
      '.cursor/hooks.json'
    );
    expect(config.hooks.stop).toHaveLength(2);
    expect(config.hooks.stop[0].command).toBe('echo user stop hook');
    expect(config.hooks.stop[1].command).toBe(
      '/usr/local/bin/node .cursor/hooks/emdash-notify.cjs stop'
    );
    expect(config.hooks.beforeShellExecution).toHaveLength(1);
    expect(config.hooks.beforeMCPExecution).toHaveLength(1);
  });

  it('detects Cursor CLI via the agent shim when cursor-agent is missing and .cursor exists', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) =>
      command === 'agent' ? '/usr/local/bin/agent' : undefined
    );
    const fs = new MemoryFs();
    fs.files.set('.cursor', '');
    const writer = makeWriter(fs);

    const wroteConfig = await writer.writeForProvider('cursor');

    expect(wroteConfig).toBe(true);
    expect(fs.files.has('.cursor/hooks.json')).toBe(true);
  });

  it('skips Cursor hooks when cursor-agent is unavailable', async () => {
    mockResolveCommandPath.mockResolvedValue(undefined);
    const fs = new MemoryFs();
    const writer = makeWriter(fs);

    await writer.writeForProvider('cursor');

    expect(fs.files.has('.cursor/hooks.json')).toBe(false);
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
});
