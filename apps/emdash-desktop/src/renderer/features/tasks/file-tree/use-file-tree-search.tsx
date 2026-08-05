import type { Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilesStore } from '@renderer/features/tasks/editor/stores/files-store';
import { buildFileTreeVisibleRows } from '@renderer/features/tasks/file-tree/tree-utils';
import { findTargetRegistry } from '@renderer/lib/find/find-target-registry';
import type { FindSearchStatus } from '@renderer/lib/find/types';
import { useFindTargetActivation } from '@renderer/lib/find/use-find-target-activation';
import { rpc } from '@renderer/lib/ipc';
import { getNextFileTreeMatchIndex, toFileTreeMatches } from './file-tree-search';

const EMPTY_SEARCH_STATUS: FindSearchStatus = {
  found: false,
  currentIndex: 0,
  total: 0,
};

const FILE_TREE_FIND_TARGET_ID = 'editor-file-tree';

interface UseFileTreeSearchOptions {
  files: FilesStore | null;
  expandedPaths: Set<string>;
  virtualizer: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex'>;
  workspaceId: string;
  containerRef: React.RefObject<HTMLElement | null>;
  hasVisibleRows: boolean;
}

export function useFileTreeSearch({
  files,
  expandedPaths,
  virtualizer,
  workspaceId,
  containerRef,
  hasVisibleRows,
}: UseFileTreeSearchOptions) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<ReturnType<typeof toFileTreeMatches>>([]);
  const [currentMatchPath, setCurrentMatchPath] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<FindSearchStatus>(EMPTY_SEARCH_STATUS);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setMatches([]);
    setCurrentMatchPath(null);
    setSearchStatus(EMPTY_SEARCH_STATUS);
  }, []);

  const revealMatch = useCallback(
    async (path: string, requestId: number) => {
      if (!files) return;
      await files.revealFile(path, expandedPaths);
      // A newer search or step may have started (and possibly already
      // resolved) while this reveal was awaiting revealFile. Scrolling here
      // would move the tree to this stale match after the UI has already
      // moved on to a newer one, so bail out rather than fight the current
      // search for the scroll position.
      if (requestId !== searchRequestRef.current) return;
      const updatedRows = buildFileTreeVisibleRows(
        files.rootNodes,
        expandedPaths,
        files.childrenById,
        files.loadedPaths
      );
      const rowIndex = updatedRows.findIndex((row) => row.node.path === path);
      if (rowIndex !== -1) {
        virtualizer.scrollToIndex(rowIndex, { align: 'center' });
      }
    },
    [expandedPaths, files, virtualizer]
  );

  // Searches the workspace-wide FTS5 file index (same one backing Cmd+K and
  // @mentions) rather than FilesStore.nodes, which only contains
  // already-expanded/loaded directories — a client-side scan would otherwise
  // silently miss any file whose parent folder hasn't been opened yet.
  const runSearch = useCallback(
    async (query: string) => {
      const requestId = ++searchRequestRef.current;
      if (!query) {
        setMatches([]);
        setCurrentMatchPath(null);
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }

      const result = await rpc.search.searchWorkspaceFiles({ workspaceId, query, limit: 200 });
      if (requestId !== searchRequestRef.current) return;

      const nextMatches = toFileTreeMatches(result);

      setMatches(nextMatches);
      if (nextMatches.length === 0) {
        setCurrentMatchPath(null);
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }

      const match = nextMatches[0];
      setCurrentMatchPath(match.path);
      setSearchStatus({ found: true, currentIndex: 1, total: nextMatches.length });
      void revealMatch(match.path, requestId);
    },
    [revealMatch, workspaceId]
  );

  const stepSearch = useCallback(
    (direction: 'next' | 'prev') => {
      if (matches.length === 0) return;
      const currentIndex = currentMatchPath
        ? matches.findIndex((m) => m.path === currentMatchPath)
        : -1;
      const nextIndex = getNextFileTreeMatchIndex(matches, currentIndex, direction);
      const match = matches[nextIndex];

      // Stepping doesn't re-run the search RPC, but it does start a new
      // reveal — bump the shared request id so an in-flight reveal from an
      // earlier step or search is treated as stale too.
      const requestId = ++searchRequestRef.current;
      setCurrentMatchPath(match.path);
      setSearchStatus({ found: true, currentIndex: nextIndex + 1, total: matches.length });
      void revealMatch(match.path, requestId);
    },
    [currentMatchPath, matches, revealMatch]
  );

  const handleSearchQueryChange = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      setCurrentMatchPath(null);
      void runSearch(nextQuery);
    },
    [runSearch]
  );

  const handleFindActivate = useCallback(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    setIsSearchOpen(true);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isSearchOpen]);

  useEffect(() => {
    return findTargetRegistry.register({
      id: FILE_TREE_FIND_TARGET_ID,
      openFind: handleFindActivate,
    });
  }, [handleFindActivate]);

  // containerRef's div only exists once the tree has rows to render, so
  // activation tracking is gated on hasVisibleRows to re-attach once the
  // real container exists.
  useFindTargetActivation({
    containerRef,
    targetId: FILE_TREE_FIND_TARGET_ID,
    enabled: hasVisibleRows,
  });

  return {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    currentMatchPath,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  };
}
