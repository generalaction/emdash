import { describe, expect, it } from 'vitest';
import type { DirectoryEntry } from './directory-reader';
import type { NodeId } from './models/tree';
import { NodeIdAssigner } from './node-id';

function dir(path: string, name: string): DirectoryEntry {
  return { path, name, type: 'directory' };
}

function file(path: string, name: string): DirectoryEntry {
  return { path, name, type: 'file' };
}

describe('NodeIdAssigner.pruneToReachable', () => {
  it('keeps nodes reachable from the root through loaded scopes', () => {
    const ids = new NodeIdAssigner();
    const a = ids.upsert(dir('/root/a', 'a'), null);
    const f = ids.upsert(file('/root/f.ts', 'f.ts'), null);
    const b = ids.upsert(dir('/root/a/b', 'b'), a.id);
    const leaf = ids.upsert(file('/root/a/b/leaf.ts', 'leaf.ts'), b.id);

    // Root (null), `a`, and `a/b` are all loaded: nothing is orphaned.
    const removed = ids.pruneToReachable(new Set<NodeId | null>([null, a.id, b.id]));

    expect(removed).toEqual([]);
    expect(ids.get(a.id)).toBeDefined();
    expect(ids.get(f.id)).toBeDefined();
    expect(ids.get(b.id)).toBeDefined();
    expect(ids.get(leaf.id)).toBeDefined();
  });

  it('prunes orphaned subtrees when an ancestor scope is unloaded', () => {
    const ids = new NodeIdAssigner();
    const a = ids.upsert(dir('/root/a', 'a'), null);
    const b = ids.upsert(dir('/root/a/b', 'b'), a.id);
    const leaf = ids.upsert(file('/root/a/b/leaf.ts', 'leaf.ts'), b.id);

    // `a`'s scope was unloaded (collapsed) but `a/b` was still marked loaded: `a/b` and its
    // children are no longer reachable from the root and must be pruned.
    const removed = ids.pruneToReachable(new Set<NodeId | null>([null, b.id]));

    const numeric = (a: number, b: number) => a - b;
    expect(removed.map((node) => node.id).sort(numeric)).toEqual([b.id, leaf.id].sort(numeric));
    expect(ids.get(a.id)).toBeDefined();
    expect(ids.get(b.id)).toBeUndefined();
    expect(ids.get(leaf.id)).toBeUndefined();
    expect(ids.getByPath('/root/a/b')).toBeUndefined();
    // `a` is still listed under the root scope, so its child set is reconciled too.
    expect(ids.childrenOf(a.id)).toEqual([]);
  });

  it('does not leak records across repeated expand/collapse churn', () => {
    const ids = new NodeIdAssigner();
    const a = ids.upsert(dir('/root/a', 'a'), null);

    for (let i = 0; i < 5; i += 1) {
      // Expand: load `a`'s children.
      const b = ids.upsert(dir('/root/a/b', 'b'), a.id);
      ids.upsert(file('/root/a/b/leaf.ts', 'leaf.ts'), b.id);
      // Collapse `a`: only root + `a` remain loaded.
      ids.pruneToReachable(new Set<NodeId | null>([null]));
    }

    // Only the root child `a` survives; the churned descendants are gone.
    expect(ids.entries().map((node) => node.path)).toEqual(['/root/a']);
  });
});

describe('NodeIdAssigner.moveDescendantPaths', () => {
  it('moves descendant paths that use Windows separators', () => {
    const ids = new NodeIdAssigner();
    const src = ids.upsert(dir('C:\\repo\\src', 'src'), null, true);
    const nested = ids.upsert(dir('C:\\repo\\src\\nested', 'nested'), src.id, true);
    const leaf = ids.upsert(file('C:\\repo\\src\\nested\\leaf.ts', 'leaf.ts'), nested.id);

    const moved = ids.moveDescendantPaths(src.id, 'C:\\repo\\src', 'C:\\repo\\lib');

    expect(moved.map((node) => node.path)).toEqual([
      'C:\\repo\\lib\\nested',
      'C:\\repo\\lib\\nested\\leaf.ts',
    ]);
    expect(ids.get(nested.id)?.path).toBe('C:\\repo\\lib\\nested');
    expect(ids.get(leaf.id)?.path).toBe('C:\\repo\\lib\\nested\\leaf.ts');
    expect(ids.getByPath('C:\\repo\\src\\nested')).toBeUndefined();
  });
});
