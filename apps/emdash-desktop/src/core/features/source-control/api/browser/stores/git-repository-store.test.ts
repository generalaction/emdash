import type {
  CheckoutHeadState,
  CheckoutStatusState,
  GitRefsState,
  GitRemotesState,
} from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-settings-store';
import type * as SourceControlClientModule from '@core/features/source-control/api/browser/client';
import type { StoredProjectGitSettings } from '@core/primitives/project-settings/api';
import { sourceControlContract } from '../..';
import { GitRepositoryStore } from './git-repository-store';

const mocks = vi.hoisted(() => ({
  getDefaultBranch: vi.fn(),
  fetchRun: vi.fn(),
  publishRun: vi.fn(),
  resolveProvider: vi.fn(),
}));

let refsState: ReturnType<typeof cell<GitRefsState>>;
let remotesState: ReturnType<typeof cell<GitRemotesState>>;
let wire: ReturnType<typeof createSourceControlWire> | undefined;

vi.mock('@core/features/source-control/api/browser/client', async (importOriginal) => {
  const actual = await importOriginal<typeof SourceControlClientModule>();
  return {
    ...actual,
    getSourceControlClient: async () => wire!.client,
  };
});

vi.mock('@core/features/repository/api/client', () => ({
  getRepositoryClient: async () => ({ resolveProvider: mocks.resolveProvider }),
}));

const origin = { name: 'origin', url: 'https://github.com/example/repo.git' };

function refs(overrides: Partial<GitRefsState> = {}): GitRefsState {
  return { branches: [], tags: [], remoteHeads: [], ...overrides };
}

function settingsStore(storedGitSettings: StoredProjectGitSettings | null): ProjectSettingsStore {
  return {
    domains: {
      gitIdentity: { stored: storedGitSettings ?? {} },
    },
  } as unknown as ProjectSettingsStore;
}

async function startStore(stored: StoredProjectGitSettings | null = null) {
  const store = new GitRepositoryStore('project-1', settingsStore(stored));
  store.start();
  await waitFor(() => !store.loading);
  return store;
}

describe('GitRepositoryStore', () => {
  beforeEach(() => {
    refsState = cell(refs());
    remotesState = cell({ remotes: [] });
    mocks.getDefaultBranch.mockResolvedValue(ok({ branch: null }));
    mocks.resolveProvider.mockResolvedValue({ success: false, error: { type: 'no_remote' } });
    wire = createSourceControlWire();
  });

  afterEach(async () => {
    await wire?.dispose();
    wire = undefined;
    vi.clearAllMocks();
  });

  describe('with zero remotes', () => {
    it('answers null remotes with unresolvable provenance instead of fabricating origin', async () => {
      const store = await startStore();

      expect(store.baseRemote).toBeNull();
      expect(store.pushRemote).toBeNull();
      expect(store.effectiveGitSettings.baseRemote).toEqual({
        value: null,
        provenance: { kind: 'unresolvable' },
      });
      expect(store.effectiveGitSettings.pushRemote).toEqual({
        value: null,
        provenance: { kind: 'unresolvable' },
      });
      expect(store.canonicalRepositoryUrl).toBeNull();
      expect(store.isBranchOnRemote('main')).toBe(false);
      store.dispose();
    });

    it('refuses fetch and publish with an honest no_remote error instead of a raw git failure', async () => {
      const store = await startStore();

      const fetchResult = await store.fetchRemote();
      expect(fetchResult.success).toBe(false);
      if (!fetchResult.success) expect(fetchResult.error.type).toBe('no_remote');

      const publishResult = await store.publishBranch('main');
      expect(publishResult.success).toBe(false);
      if (!publishResult.success) expect(publishResult.error.type).toBe('no_remote');

      expect(mocks.fetchRun).not.toHaveBeenCalled();
      expect(mocks.publishRun).not.toHaveBeenCalled();
      store.dispose();
    });

    it('still resolves a default branch from well-known local branches', async () => {
      refsState.set(refs({ branches: [{ type: 'local', branch: 'main', oid: 'a' }] }));
      const store = await startStore();

      expect(store.defaultBranch).toEqual({ type: 'local', branch: 'main', oid: 'a' });
      expect(store.effectiveGitSettings.defaultBranch.provenance).toEqual({
        kind: 'inferred',
        from: 'well-known local branch',
      });
      store.dispose();
    });
  });

  it('surfaces a stale push-remote pin as broken-setting instead of silently substituting', async () => {
    remotesState.set({ remotes: [origin] });
    const store = await startStore({ pushRemote: 'fork' });

    expect(store.pushRemote).toEqual(origin);
    expect(store.effectiveGitSettings.pushRemote).toEqual({
      value: 'origin',
      provenance: { kind: 'broken-setting', staleValue: 'fork' },
    });
    store.dispose();
  });

  it('maps the default branch from the refs-state remote HEAD onto the live branch objects', async () => {
    remotesState.set({ remotes: [origin] });
    refsState.set(
      refs({
        branches: [
          { type: 'remote', branch: 'develop', remote: origin, oid: 'b' },
          { type: 'remote', branch: 'main', remote: origin, oid: 'c' },
        ],
        remoteHeads: [{ remote: 'origin', branch: 'develop' }],
      })
    );
    const store = await startStore();

    expect(store.defaultBranch).toEqual({
      type: 'remote',
      branch: 'develop',
      remote: origin,
      oid: 'b',
    });
    expect(store.effectiveGitSettings.defaultBranch.provenance).toEqual({
      kind: 'inferred',
      from: 'remote HEAD',
    });
    store.dispose();
  });

  it('fills the base remote HEAD fact from the async lookup when refs do not know it', async () => {
    mocks.getDefaultBranch.mockResolvedValue(ok({ branch: 'develop' }));
    remotesState.set({ remotes: [origin] });
    refsState.set(
      refs({
        branches: [
          { type: 'remote', branch: 'develop', remote: origin, oid: 'b' },
          { type: 'remote', branch: 'main', remote: origin, oid: 'c' },
        ],
      })
    );
    const store = await startStore();

    await store.gitDefaultBranchInfo.load();
    await waitFor(() => store.repoFacts.remotes[0]?.headBranch === 'develop');

    expect(mocks.getDefaultBranch.mock.calls.at(0)?.[0]).toMatchObject({ remote: 'origin' });
    expect(store.defaultBranch).toEqual({
      type: 'remote',
      branch: 'develop',
      remote: origin,
      oid: 'b',
    });
    store.dispose();
  });
});

function createSourceControlWire() {
  const repositoryProvider = expose(sourceControlContract.repository.model, {
    refs: refsState,
    remotes: remotesState,
  });
  const checkoutProvider = expose(sourceControlContract.checkout.model, {
    status: cell<CheckoutStatusState>({
      kind: 'ok',
      entries: {},
      summary: { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 },
      operation: 'none',
    }),
    head: cell<CheckoutHeadState>({
      kind: 'branch',
      name: 'main',
      oid: '1234567890123456789012345678901234567890',
    }),
  });

  return createTestWire(sourceControlContract, {
    repository: {
      model: repositoryProvider,
      listWorktrees: vi.fn(),
      getDefaultBranch: mocks.getDefaultBranch,
      fetch: { run: mocks.fetchRun },
      publishBranch: { run: mocks.publishRun },
      fetchPrForReview: { run: vi.fn() },
    },
    checkout: {
      model: checkoutProvider,
      getChangedFiles: vi.fn(),
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushStateTurn();
    if (predicate()) return;
  }
  expect(predicate()).toBe(true);
}
