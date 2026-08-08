import type { CheckoutHeadState, CheckoutStatusState } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SourceControlClientModule from '@core/features/source-control/api/browser/client';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import { sourceControlContract } from '../../api';
import { GitCheckoutStore } from './git-checkout-store';

const mocks = vi.hoisted(() => ({
  getChangedFiles: vi.fn(),
  getGitRepositoryStore: vi.fn(),
  readFileText: vi.fn(),
}));

let statusState: ReturnType<typeof cell<CheckoutStatusState>>;
let headState: ReturnType<typeof cell<CheckoutHeadState>>;
let wire: ReturnType<typeof createSourceControlWire> | undefined;

vi.mock('@core/features/source-control/api/browser/client', async (importOriginal) => {
  const actual = await importOriginal<typeof SourceControlClientModule>();
  return {
    ...actual,
    getSourceControlClient: async () => wire!.client,
  };
});

vi.mock('@core/features/editor/api/browser/client', () => ({
  getEditorClient: async () => ({
    filesystem: {
      readFileText: mocks.readFileText,
    },
  }),
}));

vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: mocks.getGitRepositoryStore,
}));

describe('GitCheckoutStore', () => {
  beforeEach(() => {
    statusState = cell(status());
    headState = cell(head('main'));
    mocks.getChangedFiles.mockResolvedValue(ok({ files: [] }));
    mocks.getGitRepositoryStore.mockReturnValue({
      isBranchOnRemote: () => true,
      getBranchDivergence: () => ({ ahead: 2, behind: 1 }),
      pushRemote: { name: 'origin', url: 'https://example.com/repo.git' },
    });
    wire = createSourceControlWire();
  });

  afterEach(async () => {
    await wire?.dispose();
    wire = undefined;
    vi.clearAllMocks();
  });

  it('binds status and head through remote and refreshes changed files on status updates', async () => {
    const store = new GitCheckoutStore('project-1', 'workspace-1', '/repo');
    store.start();

    await waitFor(() => store.branchName === 'main');

    expect(store.hasData).toBe(true);
    expect(store.branchName).toBe('main');
    expect(store.aheadCount).toBe(2);
    expect(store.behindCount).toBe(1);
    expect(mocks.getChangedFiles).toHaveBeenCalledTimes(2);

    statusState.set(status('src/index.ts'));
    await waitFor(() => store.fileChanges.some((change) => change.path === 'src/index.ts'));

    expect(mocks.getChangedFiles).toHaveBeenCalledTimes(4);
    store.dispose();
  });

  it('resync refreshes remote status and head state', async () => {
    const store = new GitCheckoutStore('project-1', 'workspace-1', '/repo');
    store.start();
    await waitFor(() => store.branchName === 'main');

    headState.set(head('feature'));
    await store.resync();
    await waitFor(() => store.branchName === 'feature');

    expect(store.headDisplay).toBe('feature');
    store.dispose();
  });
});

function createSourceControlWire() {
  const repositoryProvider = expose(sourceControlContract.repository.model, {
    refs: cell({ branches: [], tags: [] }),
    remotes: cell({ remotes: [] }),
  });
  const checkoutProvider = expose(sourceControlContract.checkout.model, {
    status: statusState,
    head: headState,
  });
  const contentProvider = expose(sourceControlContract.checkout.content, {
    content: cell({
      kind: 'missing',
      path: portablePath('README.md'),
      source: { kind: 'head' },
    }),
  });

  return createTestWire(sourceControlContract, {
    repository: {
      model: repositoryProvider,
      listWorktrees: vi.fn(),
      getDefaultBranch: vi.fn(),
      fetch: { run: vi.fn() },
      publishBranch: { run: vi.fn() },
      fetchPrForReview: { run: vi.fn() },
    },
    checkout: {
      model: checkoutProvider,
      content: contentProvider,
      getChangedFiles: mocks.getChangedFiles,
      getFile: vi.fn(),
      download: vi.fn(),
      getLog: vi.fn(),
      getCommit: vi.fn(),
      getCommitFiles: vi.fn(),
      blame: vi.fn(),
      push: { run: vi.fn() },
      pull: { run: vi.fn() },
    },
  } as never);
}

function head(name: string): CheckoutHeadState {
  return {
    kind: 'branch',
    name,
    oid: '1234567890123456789012345678901234567890',
  };
}

function status(changedPath?: string): CheckoutStatusState {
  const entries: Extract<CheckoutStatusState, { kind: 'ok' }>['entries'] = {};
  if (changedPath) {
    const path = changedPath as keyof typeof entries;
    entries[path] = {
      path,
      index: 'unmodified',
      worktree: 'modified',
      isConflicted: false,
    };
  }
  return {
    kind: 'ok',
    entries,
    summary: {
      staged: 0,
      unstaged: changedPath ? 1 : 0,
      conflicted: 0,
      untracked: 0,
    },
    operation: 'none',
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushStateTurn();
    if (predicate()) return;
  }
  expect(predicate()).toBe(true);
}
