import { describe, expect, it } from 'vitest';
import { getSubtreePids, getSubtreeResources, type ProcessSnapshot } from '../processTree';

function makeSnapshot(entries: [number, number, number, number][]): ProcessSnapshot {
  const byPid = new Map();
  const childrenOf = new Map();
  for (const [pid, ppid, cpu, memory] of entries) {
    byPid.set(pid, { pid, ppid, cpu, memory });
    let children = childrenOf.get(ppid);
    if (!children) {
      children = [];
      childrenOf.set(ppid, children);
    }
    children.push(pid);
  }
  return { byPid, childrenOf };
}

describe('getSubtreePids', () => {
  it('returns empty for missing root', () => {
    const snap = makeSnapshot([[1, 0, 0, 0]]);
    expect(getSubtreePids(snap, 999)).toEqual([]);
  });

  it('returns single node', () => {
    const snap = makeSnapshot([[10, 1, 5, 1024]]);
    expect(getSubtreePids(snap, 10)).toEqual([10]);
  });

  it('walks multi-level tree', () => {
    const snap = makeSnapshot([
      [1, 0, 1, 100],
      [2, 1, 2, 200],
      [3, 1, 3, 300],
      [4, 2, 4, 400],
    ]);
    const pids = getSubtreePids(snap, 1).sort();
    expect(pids).toEqual([1, 2, 3, 4]);
  });

  it('handles cycle in ppid without infinite loop', () => {
    const snap = makeSnapshot([
      [1, 2, 1, 100],
      [2, 1, 2, 200],
    ]);
    const pids = getSubtreePids(snap, 1).sort();
    expect(pids).toEqual([1, 2]);
  });
});

describe('getSubtreeResources', () => {
  it('sums cpu and memory across subtree', () => {
    const snap = makeSnapshot([
      [1, 0, 10, 1000],
      [2, 1, 20, 2000],
      [3, 2, 30, 3000],
    ]);
    const res = getSubtreeResources(snap, 1);
    expect(res.cpu).toBe(60);
    expect(res.memory).toBe(6000);
    expect(res.pids.sort()).toEqual([1, 2, 3]);
  });

  it('returns zeros for missing root', () => {
    const snap = makeSnapshot([]);
    const res = getSubtreeResources(snap, 42);
    expect(res).toEqual({ cpu: 0, memory: 0, pids: [] });
  });
});
