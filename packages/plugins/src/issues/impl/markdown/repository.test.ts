import { describe, expect, it, vi } from 'vitest';
import { compileGlob } from './glob';
import { readBriefs, type BriefReaderDependencies, type GitOutput } from './repository';

const PATTERN = 'docs/capabilities/*/*/tasks/WO-*.md';
const REPO = '/home/dev/fridayos';

const TREE = [
  'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md',
  'docs/capabilities/agents/governance/tasks/WO-1760-gate.md',
  'docs/capabilities/agents/governance/spec.md',
  'docs/capabilities/agents/governance/tasks/README.md',
];

type GitCall = { args: readonly string[] };

/** The record separator `readCommitDates` writes into its `--pretty=format`. */
const LOG_MARK = '\u0001';

function makeDependencies(overrides: Partial<BriefReaderDependencies> = {}) {
  const calls: GitCall[] = [];
  const dependencies: BriefReaderDependencies = {
    git: vi.fn(async (_repositoryPath: string, args: readonly string[]): Promise<GitOutput> => {
      calls.push({ args });
      if (args[0] === 'rev-parse') return { status: 'ok', stdout: 'abc123\n' };
      if (args.includes('ls-tree')) return { status: 'ok', stdout: TREE.join('\0') };
      if (args.includes('log')) {
        return {
          status: 'ok',
          stdout: [
            `${LOG_MARK}2026-09-15T09:00:00Z`,
            'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md',
            '',
            `${LOG_MARK}2026-09-10T08:00:00Z`,
            'docs/capabilities/agents/governance/tasks/WO-1760-gate.md',
          ].join('\n'),
        };
      }
      if (args[0] === 'show') return { status: 'ok', stdout: `# ${args[1]}\n` };
      return { status: 'failed', message: `unexpected git ${args.join(' ')}` };
    }),
    readFile: vi.fn(async () => '# working tree\n'),
    readDirectory: vi.fn(async () => []),
    modifiedAt: vi.fn(async () => '2026-09-01T00:00:00Z'),
    ...overrides,
  };
  return { dependencies, calls };
}

describe('compileGlob', () => {
  it('matches the pattern segments and nothing deeper', () => {
    const glob = compileGlob(PATTERN);
    expect(glob.matches('docs/capabilities/a/b/tasks/WO-1-x.md')).toBe(true);
    expect(glob.matches('docs/capabilities/a/b/tasks/notes.md')).toBe(false);
    expect(glob.matches('docs/capabilities/a/b/c/tasks/WO-1-x.md')).toBe(false);
  });

  it('exposes the literal prefix so only that subtree is read', () => {
    expect(compileGlob(PATTERN).literalPrefix).toBe('docs/capabilities');
    expect(compileGlob('tasks/WO-*.md').literalPrefix).toBe('tasks');
  });

  it('lets `**` cross separators', () => {
    const glob = compileGlob('docs/**/WO-*.md');
    expect(glob.matches('docs/WO-1.md')).toBe(true);
    expect(glob.matches('docs/a/b/WO-1.md')).toBe(true);
  });

  it('refuses a pattern that escapes the repository', () => {
    expect(() => compileGlob('../secrets/*.md')).toThrow(/inside the repository/u);
  });
});

describe('readBriefs from a ref', () => {
  it('reads the files git lists for the ref, not the working tree', async () => {
    const { dependencies, calls } = makeDependencies();

    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.source).toBe('ref');
    expect(result.data.ref).toBe('origin/HEAD');
    expect(result.data.files.map((file) => file.path)).toEqual([
      'docs/capabilities/agents/governance/tasks/WO-1760-gate.md',
      'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md',
    ]);
    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(calls.some((call) => call.args[0] === 'show')).toBe(true);
  });

  it('scopes the listing to the pattern literal prefix', async () => {
    const { dependencies, calls } = makeDependencies();
    await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });
    const lsTree = calls.find((call) => call.args.includes('ls-tree'));
    expect(lsTree?.args).toEqual([
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      'origin/HEAD',
      '--',
      'docs/capabilities',
    ]);
  });

  it('takes each file last commit date from one git log pass', async () => {
    const { dependencies, calls } = makeDependencies();
    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.files.map((file) => file.updatedAt)).toEqual([
      '2026-09-10T08:00:00Z',
      '2026-09-15T09:00:00Z',
    ]);
    expect(calls.filter((call) => call.args.includes('log'))).toHaveLength(1);
  });

  it('never runs a git subcommand that writes', async () => {
    const mutating = [
      'add',
      'checkout',
      'clean',
      'commit',
      'fetch',
      'push',
      'reset',
      'update-ref',
      'worktree',
    ];
    const { dependencies, calls } = makeDependencies();
    await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });
    expect(calls.flatMap((call) => call.args).filter((arg) => mutating.includes(arg))).toEqual([]);
  });

  it('reports a listing failure as a typed error', async () => {
    const { dependencies } = makeDependencies({
      git: vi.fn(async (_path: string, args: readonly string[]): Promise<GitOutput> => {
        if (args[0] === 'rev-parse') return { status: 'ok', stdout: 'abc\n' };
        return { status: 'failed', message: 'fatal: not a tree object' };
      }),
    });

    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'not_found_or_no_access',
        message: expect.stringContaining('fatal: not a tree object'),
      },
    });
  });
});

describe('readBriefs from the working tree', () => {
  const directories: Record<string, { name: string; isDirectory: boolean }[]> = {
    [`${REPO}/docs/capabilities`]: [{ name: 'platform', isDirectory: true }],
    [`${REPO}/docs/capabilities/platform`]: [{ name: 'connectors', isDirectory: true }],
    [`${REPO}/docs/capabilities/platform/connectors`]: [
      { name: 'tasks', isDirectory: true },
      { name: 'spec.md', isDirectory: false },
    ],
    [`${REPO}/docs/capabilities/platform/connectors/tasks`]: [
      { name: 'WO-1811-retries.md', isDirectory: false },
      { name: 'README.md', isDirectory: false },
    ],
  };

  function workingTreeDependencies() {
    return makeDependencies({
      readDirectory: vi.fn(async (path: string) => directories[path] ?? []),
    });
  }

  it('walks only the pattern subtree when no ref is configured', async () => {
    const { dependencies } = workingTreeDependencies();

    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: '',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.source).toBe('working-tree');
    expect(result.data.files.map((file) => file.path)).toEqual([
      'docs/capabilities/platform/connectors/tasks/WO-1811-retries.md',
    ]);
    expect(result.data.files[0]?.updatedAt).toBe('2026-09-01T00:00:00Z');
    expect(dependencies.git).not.toHaveBeenCalled();
  });

  it('falls back to the working tree when the configured ref does not resolve', async () => {
    const { dependencies } = workingTreeDependencies();
    dependencies.git = vi.fn(async (): Promise<GitOutput> => ({ status: 'ok', stdout: '' }));

    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: PATTERN,
      trunkRef: 'origin/HEAD',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.source).toBe('working-tree');
    expect(result.data.files).toHaveLength(1);
  });

  it('refuses a pattern that escapes the repository', async () => {
    const { dependencies } = workingTreeDependencies();
    const result = await readBriefs(dependencies, {
      repositoryPath: REPO,
      pattern: '../../*.md',
    });
    expect(result).toEqual({
      success: false,
      error: { type: 'invalid_input', message: expect.stringContaining('inside the repository') },
    });
  });

  it('refuses an empty repository path', async () => {
    const { dependencies } = workingTreeDependencies();
    const result = await readBriefs(dependencies, { repositoryPath: '  ', pattern: PATTERN });
    expect(result.success).toBe(false);
  });
});
