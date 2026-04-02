import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
  type ReadResult,
  type WriteResult,
} from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { HookConfigWriter } from './hook-config';

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: vi.fn().mockResolvedValue('/usr/bin/mock-agent'),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function makeReadResult(content: string): ReadResult {
  return { content, truncated: false, totalSize: content.length };
}

function makeWriteResult(): WriteResult {
  return { success: true, bytesWritten: 0 };
}

function notFoundError(path: string): FileSystemError {
  return new FileSystemError(`File not found: ${path}`, FileSystemErrorCodes.NOT_FOUND, path);
}

function makeMockFs(overrides: Partial<FileSystemProvider> = {}): FileSystemProvider {
  return {
    read: vi.fn().mockRejectedValue(notFoundError('file')),
    write: vi.fn().mockResolvedValue(makeWriteResult()),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    list: vi.fn(),
    stat: vi.fn(),
    search: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  } as FileSystemProvider;
}

describe('HookConfigWriter.writeClaudeHooks', () => {
  let fs: FileSystemProvider;
  let writer: HookConfigWriter;
  let exec: ExecFn;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCommandPath).mockResolvedValue('/usr/bin/mock-agent');
    fs = makeMockFs();
    exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    writer = new HookConfigWriter(fs, exec);
  });

  it('writes hooks when settings file does not exist', async () => {
    await writer.writeClaudeHooks();

    expect(fs.write).toHaveBeenCalledOnce();
    const [path, content] = vi.mocked(fs.write).mock.calls[0];
    expect(path).toBe('.claude/settings.local.json');
    const written = JSON.parse(content);

    expect(written.hooks.Notification).toHaveLength(1);
    expect(written.hooks.Notification[0].hooks).toHaveLength(1);
    expect(written.hooks.Notification[0].hooks[0].type).toBe('command');
    expect(written.hooks.Notification[0].hooks[0].command).toContain('EMDASH_HOOK_PORT');
    expect(written.hooks.Notification[0].hooks[0].command).toContain('notification');
    expect(written.hooks.Stop).toHaveLength(1);
    expect(written.hooks.Stop[0].hooks[0].command).toContain('stop');
  });

  it('preserves existing non-emdash hooks and other keys', async () => {
    const existing = {
      someKey: 'keep',
      hooks: {
        Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user-hook' }] }],
      },
    };
    vi.mocked(fs.read).mockResolvedValue(makeReadResult(JSON.stringify(existing)));

    await writer.writeClaudeHooks();

    const written = JSON.parse(vi.mocked(fs.write).mock.calls[0][1]);
    expect(written.someKey).toBe('keep');
    expect(written.hooks.Notification).toHaveLength(2);
    expect(written.hooks.Notification[0].hooks[0].command).toBe('echo user-hook');
    expect(written.hooks.Notification[1].hooks[0].command).toContain('EMDASH_HOOK_PORT');
  });

  it('strips old emdash entries on re-run (idempotent)', async () => {
    const existing = {
      hooks: {
        Notification: [
          { matcher: '', hooks: [{ type: 'command', command: 'echo user-hook' }] },
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'curl ... http://127.0.0.1:$EMDASH_HOOK_PORT/hook || true',
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'curl ... http://127.0.0.1:$EMDASH_HOOK_PORT/hook || true',
              },
            ],
          },
        ],
      },
    };
    vi.mocked(fs.read).mockResolvedValue(makeReadResult(JSON.stringify(existing)));

    await writer.writeClaudeHooks();

    const written = JSON.parse(vi.mocked(fs.write).mock.calls[0][1]);

    expect(written.hooks.Notification).toHaveLength(2);
    expect(written.hooks.Stop).toHaveLength(1);
  });

  it('handles malformed JSON gracefully', async () => {
    vi.mocked(fs.read).mockResolvedValue(makeReadResult('not valid json {{{'));

    await writer.writeClaudeHooks();

    const written = JSON.parse(vi.mocked(fs.write).mock.calls[0][1]);
    expect(written.hooks.Notification).toHaveLength(1);
    expect(written.hooks.Stop).toHaveLength(1);
  });
});

describe('HookConfigWriter.writeCodexNotify', () => {
  let fs: FileSystemProvider;
  let writer: HookConfigWriter;
  let exec: ExecFn;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveCommandPath).mockResolvedValue('/usr/bin/mock-agent');
    fs = makeMockFs();
    exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    writer = new HookConfigWriter(fs, exec);
  });

  it('writes notify when config file does not exist', async () => {
    await writer.writeCodexNotify();

    expect(fs.write).toHaveBeenCalledOnce();
    const [path, content] = vi.mocked(fs.write).mock.calls[0];
    expect(path).toBe('.codex/config.toml');
    expect(content).toContain('notify');
    expect(content).toContain('EMDASH_HOOK_PORT');
  });

  it('preserves existing keys when overwriting notify', async () => {
    const existingToml = 'model = "o3"\napproval_policy = "unless-allow-listed"\n';
    vi.mocked(fs.read).mockResolvedValue(makeReadResult(existingToml));

    await writer.writeCodexNotify();

    const written = vi.mocked(fs.write).mock.calls[0][1];
    expect(written).toContain('model = "o3"');
    expect(written).toContain('approval_policy');
    expect(written).toContain('notify');
  });
});

describe('HookConfigWriter.writeAll', () => {
  it('does not throw if one writer fails', async () => {
    const fs = makeMockFs({
      read: vi.fn().mockRejectedValue(new Error('permission denied')),
      write: vi.fn().mockRejectedValue(new Error('permission denied')),
    });
    const exec: ExecFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const writer = new HookConfigWriter(fs, exec);

    await expect(writer.writeAll()).resolves.toBeUndefined();
  });
});
