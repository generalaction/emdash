import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesStore } from '@renderer/features/tasks/editor/stores/files-store';
import type { RenderableFileNode } from '@renderer/features/tasks/file-tree/tree-utils';
import { useFileTreeSearch } from '@renderer/features/tasks/file-tree/use-file-tree-search';

const searchWorkspaceFiles = vi.hoisted(() => vi.fn());

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { search: { searchWorkspaceFiles: searchWorkspaceFiles } },
}));

let nextNodeId = 1;

function makeNode(path: string): RenderableFileNode {
  const name = path.split('/').pop() ?? path;
  return {
    id: nextNodeId++,
    path,
    name,
    parentId: null,
    parentPath: null,
    depth: 0,
    type: 'file',
    childrenLoaded: true,
    isHidden: false,
  };
}

/**
 * Fake FilesStore: revealFile's completion order is controlled by the test
 * via a queue of deferred promises, so a race between an earlier and a later
 * reveal can be reproduced deterministically.
 */
function createFakeFiles(paths: string[]) {
  const rootNodes = paths.map(makeNode);
  const childrenById = new Map();
  const loadedPaths = new Set(paths);
  const revealResolvers: Array<() => void> = [];

  const files = {
    rootNodes,
    childrenById,
    loadedPaths,
    revealFile: (_path: string, _expandedPaths: Set<string>) =>
      new Promise<void>((resolve) => {
        revealResolvers.push(resolve);
      }),
  } as unknown as FilesStore;

  return { files, revealResolvers };
}

function createFakeVirtualizer() {
  const scrollCalls: number[] = [];
  return {
    virtualizer: { scrollToIndex: (index: number) => scrollCalls.push(index) },
    scrollCalls,
  };
}

let latestCurrentMatchPath: string | null | undefined;
let triggerQueryChange: ((q: string) => void) | undefined;
let triggerStepSearch: ((direction: 'next' | 'prev') => void) | undefined;

function Probe({
  files,
  virtualizer,
}: {
  files: FilesStore;
  virtualizer: { scrollToIndex: (index: number) => void };
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { currentMatchPath, handleSearchQueryChange, stepSearch } = useFileTreeSearch({
    files,
    expandedPaths: new Set(),
    virtualizer,
    workspaceId: 'ws-1',
    containerRef,
    hasVisibleRows: true,
  });
  latestCurrentMatchPath = currentMatchPath;
  triggerQueryChange = handleSearchQueryChange;
  triggerStepSearch = stepSearch;
  return <div ref={containerRef} />;
}

describe('useFileTreeSearch', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestCurrentMatchPath = undefined;
    triggerQueryChange = undefined;
    triggerStepSearch = undefined;
    searchWorkspaceFiles.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not let an earlier, slower reveal override a later, faster one', async () => {
    // Regression coverage: only the search RPC itself was guarded against
    // staleness — the reveal/scroll step that follows it was not. If the
    // user changes the query again (or steps) before an earlier reveal's
    // revealFile() promise resolves, both reveals used to proceed
    // independently, and whichever one's await happened to finish last would
    // scroll the tree to its match — even if it belonged to an older,
    // already-superseded query.
    searchWorkspaceFiles.mockImplementation(async (q: { query: string }) => {
      if (q.query === 'a') return [{ path: '/root/a.ts', filename: 'a.ts' }];
      if (q.query === 'b') return [{ path: '/root/b.ts', filename: 'b.ts' }];
      return [];
    });

    const { files, revealResolvers } = createFakeFiles(['/root/a.ts', '/root/b.ts']);
    const { virtualizer, scrollCalls } = createFakeVirtualizer();

    act(() => {
      root.render(<Probe files={files} virtualizer={virtualizer} />);
    });

    // Query "a" starts a reveal (resolver[0]), then query "b" starts a
    // second, newer reveal (resolver[1]) before the first has resolved.
    await act(async () => triggerQueryChange?.('a'));
    await act(async () => triggerQueryChange?.('b'));
    expect(revealResolvers).toHaveLength(2);
    expect(latestCurrentMatchPath).toBe('/root/b.ts');

    // Resolve the *older* reveal ("a") last — simulating a slow revealFile
    // call for the superseded query finishing after the newer one already
    // completed and scrolled.
    await act(async () => {
      revealResolvers[1]!(); // "b"'s reveal finishes first
      await Promise.resolve();
      revealResolvers[0]!(); // "a"'s stale reveal finishes after
      await Promise.resolve();
    });

    // Only "b"'s row (index 1 in rootNodes) should ever have been scrolled
    // to — the stale "a" reveal must not scroll after the fact.
    expect(scrollCalls).toEqual([1]);
    expect(latestCurrentMatchPath).toBe('/root/b.ts');
  });

  it('does not let a stale reveal from an earlier step override a later step', async () => {
    searchWorkspaceFiles.mockImplementation(async () => [
      { path: '/root/a.ts', filename: 'a.ts' },
      { path: '/root/b.ts', filename: 'b.ts' },
      { path: '/root/c.ts', filename: 'c.ts' },
    ]);

    const { files, revealResolvers } = createFakeFiles(['/root/a.ts', '/root/b.ts', '/root/c.ts']);
    const { virtualizer, scrollCalls } = createFakeVirtualizer();

    act(() => {
      root.render(<Probe files={files} virtualizer={virtualizer} />);
    });

    await act(async () => triggerQueryChange?.('x'));
    expect(revealResolvers).toHaveLength(1);

    // Step twice in a row before the first search's reveal resolves.
    act(() => triggerStepSearch?.('next'));
    act(() => triggerStepSearch?.('next'));
    expect(revealResolvers).toHaveLength(3);
    expect(latestCurrentMatchPath).toBe('/root/c.ts');

    // Resolve out of order: the middle step's reveal finishes last.
    await act(async () => {
      revealResolvers[2]!();
      await Promise.resolve();
      revealResolvers[0]!();
      await Promise.resolve();
      revealResolvers[1]!();
      await Promise.resolve();
    });

    // Only the final step's match (c.ts, index 2) should have been scrolled to.
    expect(scrollCalls).toEqual([2]);
    expect(latestCurrentMatchPath).toBe('/root/c.ts');
  });
});
