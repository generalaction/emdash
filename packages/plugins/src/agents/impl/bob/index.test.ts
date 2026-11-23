import type { CommandContext, PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it, vi } from 'vitest';
import { provider } from './index';
import { BOB_TRUSTED_FOLDERS_PATH } from './trust';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cli: 'bob',
    autoApprove: false,
    isResuming: false,
    model: '',
    ...overrides,
  };
}

function buildArgs(overrides: Partial<CommandContext> = {}): string[] {
  return provider.behavior.prompt!.buildCommand(ctx(overrides)).args;
}

function createMemoryFs(initial: Record<string, string> = {}): PluginFs & {
  writes: Array<{ path: string; content: string }>;
} {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; content: string }> = [];

  return {
    writes,
    read: async (path) => files.get(path) ?? null,
    write: vi.fn(async (path, content) => {
      writes.push({ path, content });
      files.set(path, content);
    }),
    delete: async (path) => {
      files.delete(path);
    },
    exists: async (path) => files.has(path),
    list: async () => [],
  };
}

describe('Bob plugin', () => {
  it('declares terminal, ACP, MCP, and workspace-trust support', () => {
    expect(provider.metadata).toMatchObject({ id: 'bob', name: 'IBM Bob' });
    expect(provider.capabilities.acp.kind).toBe('supported');
    expect(provider.capabilities.autoApprove.kind).toBe('supported');
    expect(provider.capabilities.prompt).toEqual({ kind: 'argv', flag: '--' });
    expect(provider.capabilities.sessions.kind).toBe('resumable');
    expect(provider.capabilities.trust.kind).toBe('supported');
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.validate()).toEqual([]);
  });

  it('probes the bob binary and offers the documented installers', () => {
    const dependency = provider.capabilities.hostDependency;

    expect(dependency.binaryNames).toEqual(['bob']);
    expect(dependency.installCommands?.linux?.map((option) => option.command)).toEqual([
      'npm install -g @ibm/bob --allow-scripts=@officecli/officecli',
      'curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash',
    ]);
    expect(dependency.installCommands?.macos?.find((option) => option.recommended)?.method).toBe(
      'curl'
    );
    expect(
      dependency.installCommands?.windows?.find((option) => option.recommended)?.command
    ).toContain('https://bob.ibm.com/download/bobshell.ps1');
  });
});

describe('Bob terminal command', () => {
  it('opens the interactive chat client', () => {
    expect(buildArgs()).toEqual(['chat']);
    expect(buildArgs({ autoApprove: true })).toEqual(['chat', '--auto-approve']);
  });

  it('seeds the first turn after `--` so option-like prompts stay positional', () => {
    expect(buildArgs({ autoApprove: true, initialPrompt: 'fix the build' })).toEqual([
      'chat',
      '--auto-approve',
      '--',
      'fix the build',
    ]);
    // Without the separator Bob 2.1.0 exits with `unexpected argument "--help me fix it"`.
    expect(buildArgs({ initialPrompt: '--help me fix it\nsecond line' })).toEqual([
      'chat',
      '--',
      '--help me fix it\nsecond line',
    ]);
  });

  it('keeps user extra args ahead of the prompt', () => {
    expect(buildArgs({ initialPrompt: 'plan the work', extraArgs: ['--mode', 'plan'] })).toEqual([
      'chat',
      '--mode',
      'plan',
      '--',
      'plan the work',
    ]);
  });

  it('resumes the latest task of the workspace without resending the prompt', () => {
    expect(
      buildArgs({ isResuming: true, autoApprove: true, initialPrompt: 'fix the build' })
    ).toEqual(['chat', '--resume', '--auto-approve']);
    // The Emdash conversation id is not a Bob task id, so it must never follow `--resume`.
    expect(buildArgs({ isResuming: true, sessionId: 'emdash-conversation-id' })).toEqual([
      'chat',
      '--resume',
    ]);
  });
});

describe('Bob workspace trust', () => {
  const trust = () => provider.behavior.trust!;

  it('creates the trust store in the layout Bob Shell 2.x writes', async () => {
    const fs = createMemoryFs();

    await trust().trustWorkspace(fs, { workspacePath: '/work/task-1' });

    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0].path).toBe(BOB_TRUSTED_FOLDERS_PATH);
    expect(JSON.parse(fs.writes[0].content)).toEqual({
      version: 1,
      folders: { '/work/task-1': 'TRUST_FOLDER' },
    });
  });

  it('adds a worktree while preserving existing decisions', async () => {
    const fs = createMemoryFs({
      [BOB_TRUSTED_FOLDERS_PATH]: JSON.stringify({
        version: 1,
        folders: { '/other/repo': 'DONT_TRUST', '/safe/project': 'TRUST_PARENT' },
      }),
    });

    await trust().trustWorkspace(fs, { workspacePath: '/work/task-2' });

    expect(JSON.parse(fs.writes[0].content).folders).toEqual({
      '/other/repo': 'DONT_TRUST',
      '/safe/project': 'TRUST_PARENT',
      '/work/task-2': 'TRUST_FOLDER',
    });
  });

  // Mirrors Bob Shell 2.1.0: TRUST_FOLDER covers subfolders, TRUST_PARENT trusts the parent of
  // the listed folder, and DONT_TRUST applies to the exact folder only.
  it.each([
    ['its own DONT_TRUST decision', { '/work/task-3': 'DONT_TRUST' }, '/work/task-3'],
    ['a TRUST_FOLDER entry on an ancestor', { '/work': 'TRUST_FOLDER' }, '/work/task-3'],
    ['a TRUST_PARENT entry on a sibling', { '/work/task-1': 'TRUST_PARENT' }, '/work/task-3'],
    ['a TRUST_PARENT entry below the root', { '/work': 'TRUST_PARENT' }, '/elsewhere/task-3'],
    ['a Windows TRUST_FOLDER ancestor', { 'C:\\work\\': 'TRUST_FOLDER' }, 'C:\\work\\task-3'],
    ['a Windows TRUST_PARENT sibling', { 'C:\\work\\task-1': 'TRUST_PARENT' }, 'C:\\work\\task-3'],
  ])(
    'does not rewrite when the folder is resolved by %s',
    async (_label, folders, workspacePath) => {
      const fs = createMemoryFs({
        [BOB_TRUSTED_FOLDERS_PATH]: JSON.stringify({ version: 1, folders }),
      });

      await trust().trustWorkspace(fs, { workspacePath });

      expect(fs.writes).toHaveLength(0);
    }
  );

  it.each([
    ['a sibling that only shares a prefix', { '/work': 'TRUST_FOLDER' }, '/workspace/task-4'],
    ['a DONT_TRUST ancestor', { '/work': 'DONT_TRUST' }, '/work/task-4'],
    ['a TRUST_PARENT entry elsewhere', { '/safe/project': 'TRUST_PARENT' }, '/work/task-4'],
  ])('still trusts the worktree next to %s', async (_label, folders, workspacePath) => {
    const fs = createMemoryFs({
      [BOB_TRUSTED_FOLDERS_PATH]: JSON.stringify({ version: 1, folders }),
    });

    await trust().trustWorkspace(fs, { workspacePath });

    expect(JSON.parse(fs.writes[0].content).folders).toEqual({
      ...folders,
      [workspacePath]: 'TRUST_FOLDER',
    });
  });

  it.each([
    ['a newer store version', { version: 2, folders: {} }],
    ['a layout without a folders map', { '/work/legacy': 'TRUST_FOLDER' }],
  ])('leaves %s untouched', async (_label, config) => {
    const fs = createMemoryFs({ [BOB_TRUSTED_FOLDERS_PATH]: JSON.stringify(config) });

    await trust().trustWorkspace(fs, { workspacePath: '/work/task-5' });

    expect(fs.writes).toHaveLength(0);
  });
});
