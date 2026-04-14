import * as toml from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSystemProvider, ReadResult, WriteResult } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { HookConfigWriter } from './hook-config';

const resolveCommandPathMock = vi.hoisted(() => vi.fn());

vi.mock('@main/core/dependencies/probe', () => ({
  resolveCommandPath: resolveCommandPathMock,
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type FsHarness = {
  files: Map<string, string>;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  fs: Pick<FileSystemProvider, 'read' | 'write'>;
};

function createFsHarness(initial: Record<string, string> = {}): FsHarness {
  const files = new Map(Object.entries(initial));

  const read = vi.fn(async (path: string): Promise<ReadResult> => {
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    const content = files.get(path) ?? '';
    return {
      content,
      truncated: false,
      totalSize: content.length,
    };
  });

  const write = vi.fn(async (path: string, content: string): Promise<WriteResult> => {
    files.set(path, content);
    return {
      success: true,
      bytesWritten: content.length,
    };
  });

  return {
    files,
    read,
    write,
    fs: {
      read,
      write,
    },
  };
}

function createExec(): ExecFn {
  return vi.fn(async () => ({ stdout: '', stderr: '' }));
}

describe('HookConfigWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCommandPathMock.mockResolvedValue('/usr/bin/agent');
  });

  it('writes Claude hook config and ensures .gitignore entry on demand', async () => {
    const harness = createFsHarness({
      '.claude/settings.local.json': JSON.stringify({
        hooks: {
          Notification: [
            { hooks: [{ type: 'command', command: 'echo keep-me' }] },
            { hooks: [{ type: 'command', command: 'echo $EMDASH_HOOK_PORT' }] },
          ],
        },
      }),
    });
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('claude');

    const settingsRaw = harness.files.get('.claude/settings.local.json');
    expect(settingsRaw).toBeDefined();
    const settings = JSON.parse(settingsRaw ?? '{}') as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };

    const notificationHooks = settings.hooks?.Notification ?? [];
    expect(notificationHooks).toHaveLength(2);
    expect(notificationHooks[0]?.hooks?.[0]?.command).toBe('echo keep-me');
    expect(JSON.stringify(notificationHooks[1])).toContain('EMDASH_HOOK_PORT');

    const stopHooks = settings.hooks?.Stop ?? [];
    expect(stopHooks).toHaveLength(1);
    expect(JSON.stringify(stopHooks[0])).toContain('EMDASH_HOOK_PORT');

    expect(harness.files.get('.gitignore')).toBe('.claude/settings.local.json\n');
  });

  it('does not duplicate .gitignore entries when already present', async () => {
    const harness = createFsHarness({
      '.gitignore': '.claude/settings.local.json\n',
    });
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('claude');

    expect(harness.files.get('.gitignore')).toBe('.claude/settings.local.json\n');
  });

  it('does not add redundant .gitignore entries covered by a directory rule', async () => {
    const harness = createFsHarness({
      '.gitignore': '.claude/\n',
    });
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('claude');

    expect(harness.files.get('.gitignore')).toBe('.claude/\n');
  });

  it('writes Codex notify config and ensures .gitignore entry', async () => {
    const harness = createFsHarness({
      '.codex/config.toml': 'model = "gpt-5"\n',
    });
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('codex');

    const codexRaw = harness.files.get('.codex/config.toml');
    expect(codexRaw).toBeDefined();
    const parsed = toml.parse(codexRaw ?? '') as { model?: string; notify?: string[] };
    expect(parsed.model).toBe('gpt-5');
    expect(parsed.notify).toBeDefined();
    expect(parsed.notify?.[0]).toBe('bash');
    expect((parsed.notify ?? []).join(' ')).toContain('EMDASH_HOOK_PORT');

    expect(harness.files.get('.gitignore')).toBe('.codex/config.toml\n');
  });

  it('skips writing when provider command is unavailable', async () => {
    resolveCommandPathMock.mockResolvedValue(undefined);
    const harness = createFsHarness();
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('claude');

    expect(harness.write).not.toHaveBeenCalled();
  });

  it('ignores unsupported providers', async () => {
    const harness = createFsHarness();
    const writer = new HookConfigWriter(harness.fs as FileSystemProvider, createExec());

    await writer.writeForProvider('gemini');

    expect(harness.write).not.toHaveBeenCalled();
  });
});
