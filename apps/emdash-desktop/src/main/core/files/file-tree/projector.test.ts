import type {
  FileNode,
  FileTreeSequences,
  FileTreeSnapshot,
  FileTreeUpdate,
  IFileTree,
  NodeId,
  SubscribedSnapshot,
} from '@emdash/core/files';
import { ok, type Result, type Unsubscribe } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTreeProjector, type FileTreeProjectionPush } from './projector';

type Scope = NodeId | null;
type DeltaOp = { op: 'put'; key: NodeId; value: FileNode } | { op: 'del'; key: NodeId };

function dirNode(id: NodeId, path: string, parentId: Scope = null): FileNode {
  const parts = path.split('/').filter(Boolean);
  return {
    id,
    path,
    name: parts[parts.length - 1] ?? path,
    parentId,
    type: 'directory',
    childrenLoaded: false,
  };
}

function fileNode(id: NodeId, path: string, parentId: Scope): FileNode {
  const parts = path.split('/').filter(Boolean);
  return {
    id,
    path,
    name: parts[parts.length - 1] ?? path,
    parentId,
    type: 'file',
    childrenLoaded: false,
  };
}

/** Minimal in-memory IFileTree that drives the projector's subscriber and records ref-count calls. */
class FakeTree implements IFileTree {
  readonly rootPath = '/repo';
  readonly registerCalls: Scope[] = [];
  readonly unregisterCalls: Scope[] = [];
  readonly revealCalls: string[] = [];
  private cb: ((update: FileTreeUpdate) => void) | undefined;

  constructor(
    private readonly initial: Array<[NodeId, FileNode]>,
    private readonly onRegister?: (scope: Scope) => Array<[NodeId, FileNode]> | undefined
  ) {}

  async ready(): Promise<Result<void, never>> {
    return ok<void>();
  }

  subscribe(cb: (update: FileTreeUpdate) => void): Unsubscribe {
    this.cb = cb;
    cb({ kind: 'snapshot', entries: this.initial.slice(), generation: 1, sequence: 0 });
    return () => {
      this.cb = undefined;
    };
  }

  async registerDir(dirId: Scope): Promise<Result<FileTreeSequences, never>> {
    this.registerCalls.push(dirId);
    const children = this.onRegister?.(dirId);
    if (children && children.length > 0) {
      this.emitDelta(children.map(([key, value]) => ({ op: 'put' as const, key, value })));
    }
    return ok({ tree: 1 });
  }

  async unregisterDir(dirId: Scope): Promise<Result<FileTreeSequences, never>> {
    this.unregisterCalls.push(dirId);
    return ok({ tree: 1 });
  }

  async revealPath(path: string): Promise<Result<FileTreeSequences, never>> {
    this.revealCalls.push(path);
    return ok({ tree: 1 });
  }

  emitDelta(ops: DeltaOp[]): void {
    this.cb?.({ kind: 'delta', generation: 1, sequence: 1, ops });
  }

  // Unused by the projector.
  async getSnapshot(): Promise<Result<FileTreeSnapshot, never>> {
    throw new Error('not implemented');
  }
  subscribeWithSnapshot(): Promise<Result<SubscribedSnapshot<FileTreeSnapshot>, never>> {
    throw new Error('not implemented');
  }
  async refresh(): Promise<Result<FileTreeSnapshot, never>> {
    throw new Error('not implemented');
  }
  async dispose(): Promise<void> {}
}

function countOf<T>(values: T[], target: T): number {
  return values.filter((value) => value === target).length;
}

describe('FileTreeProjector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds the root scope and pins it on open', async () => {
    const tree = new FakeTree([[1, dirNode(1, '/repo/src')]]);
    const pushes: FileTreeProjectionPush[] = [];
    const projector = new FileTreeProjector(tree, (p) => pushes.push(p));

    const result = await projector.openProjection();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.subscriptionId).toBeTruthy();
    expect(result.data.version).toBe(1);
    expect(result.data.scopes).toEqual([{ scopeId: null, entries: [dirNode(1, '/repo/src')] }]);
    expect(tree.registerCalls).toEqual([null]);
    projector.dispose();
  });

  it('ref-counts core registrations across projections', async () => {
    const tree = new FakeTree([[1, dirNode(1, '/repo/src')]], (scope) =>
      scope === 1 ? [[2, fileNode(2, '/repo/src/index.ts', 1)]] : undefined
    );
    const pushes: FileTreeProjectionPush[] = [];
    const projector = new FileTreeProjector(tree, (p) => pushes.push(p));

    const open1 = await projector.openProjection();
    const open2 = await projector.openProjection();
    expect(open1.success && open2.success).toBe(true);
    if (!open1.success || !open2.success) return;
    const sub1 = open1.data.subscriptionId;
    const sub2 = open2.data.subscriptionId;

    const reg1 = await projector.registerDir(sub1, 1);
    expect(reg1.success).toBe(true);
    if (!reg1.success) return;
    expect(reg1.data.version).toBe(2);
    // Scope contents are delivered via the push channel, not the RPC return value.
    const sub1Scope1 = pushes
      .filter((p) => p.subscriptionId === sub1)
      .flatMap((p) => p.scopes)
      .find((s) => s.scopeId === 1);
    expect(sub1Scope1?.entries).toEqual([fileNode(2, '/repo/src/index.ts', 1)]);

    await projector.registerDir(sub2, 1);

    // Root retained once across both opens; scope 1 retained once across both registers.
    expect(countOf(tree.registerCalls, null)).toBe(1);
    expect(countOf(tree.registerCalls, 1)).toBe(1);

    await projector.closeProjection(sub1);
    expect(tree.unregisterCalls).toEqual([]); // still held by sub2

    await projector.closeProjection(sub2);
    expect(tree.unregisterCalls).toEqual([null, 1]); // released on last projection close

    projector.dispose();
  });

  it('coalesces dirty scopes and projects only registered scopes per subscription', async () => {
    const tree = new FakeTree([[1, dirNode(1, '/repo/src')]], (scope) =>
      scope === 1 ? [[2, fileNode(2, '/repo/src/index.ts', 1)]] : undefined
    );
    const pushes: FileTreeProjectionPush[] = [];
    const projector = new FileTreeProjector(tree, (p) => pushes.push(p));

    const open1 = await projector.openProjection();
    const open2 = await projector.openProjection();
    if (!open1.success || !open2.success) return;
    const sub1 = open1.data.subscriptionId;
    const sub2 = open2.data.subscriptionId;
    await projector.registerDir(sub1, 1);

    // Drain any coalesced flushes from setup, then observe only the next batch.
    await vi.advanceTimersByTimeAsync(32);
    pushes.length = 0;

    tree.emitDelta([
      { op: 'put', key: 3, value: fileNode(3, '/repo/src/b.ts', 1) },
      { op: 'put', key: 4, value: dirNode(4, '/repo/other', null) },
    ]);
    await vi.advanceTimersByTimeAsync(32);

    const sub1Pushes = pushes.filter((p) => p.subscriptionId === sub1);
    const sub2Pushes = pushes.filter((p) => p.subscriptionId === sub2);

    const last1 = sub1Pushes.at(-1);
    expect(last1).toBeDefined();
    const scope1 = last1?.scopes.find((s) => s.scopeId === 1);
    expect(scope1?.entries.map((entry) => entry.path)).toContain('/repo/src/b.ts');
    const last1ScopeIds = last1?.scopes.map((s) => s.scopeId) ?? [];
    expect(last1ScopeIds).toHaveLength(2);
    expect(last1ScopeIds).toContain(null);
    expect(last1ScopeIds).toContain(1);

    const last2 = sub2Pushes.at(-1);
    expect(last2).toBeDefined();
    // sub2 never registered scope 1, so it only receives the root scope update.
    expect(last2?.scopes.map((s) => s.scopeId)).toEqual([null]);

    projector.dispose();
  });

  it('bumps a monotonic version on each projection', async () => {
    const tree = new FakeTree([[1, dirNode(1, '/repo/src')]], (scope) =>
      scope === 1 ? [[2, fileNode(2, '/repo/src/index.ts', 1)]] : undefined
    );
    const versions: number[] = [];
    const projector = new FileTreeProjector(tree, (p) => versions.push(p.version));

    const open = await projector.openProjection();
    if (!open.success) return;
    const sub = open.data.subscriptionId;

    await projector.registerDir(sub, 1);
    tree.emitDelta([{ op: 'put', key: 5, value: fileNode(5, '/repo/src/c.ts', 1) }]);
    await vi.advanceTimersByTimeAsync(32);

    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
    projector.dispose();
  });

  it('registers ancestor scopes when revealing a path', async () => {
    const tree = new FakeTree([[1, dirNode(1, '/repo/src')]], (scope) => {
      if (scope === 1) return [[2, dirNode(2, '/repo/src/a', 1)]];
      if (scope === 2) return [[3, fileNode(3, '/repo/src/a/b.ts', 2)]];
      return undefined;
    });
    const projector = new FileTreeProjector(tree, () => {});

    const open = await projector.openProjection();
    if (!open.success) return;
    const sub = open.data.subscriptionId;

    // Warm up the cache so reveal can resolve the ancestor chain by path.
    await projector.registerDir(sub, 1);
    await projector.registerDir(sub, 2);

    const revealed = await projector.revealPath(sub, '/repo/src/a/b.ts');
    expect(revealed.success).toBe(true);
    expect(tree.revealCalls).toEqual(['/repo/src/a/b.ts']);

    projector.dispose();
  });
});
