import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { findTargetRegistry } from '@renderer/lib/find/find-target-registry';
import type { FindSearchStatus } from '@renderer/lib/find/types';
import { useFindTargetActivation } from '@renderer/lib/find/use-find-target-activation';
import type { BrowserWebviewAdapter, BrowserWebviewElement } from './browser-webview-types';

const EMPTY_SEARCH_STATUS: FindSearchStatus = {
  found: false,
  currentIndex: 0,
  total: 0,
};

interface UseBrowserFindOptions {
  adapter: BrowserWebviewAdapter | null;
  webview: BrowserWebviewElement | null;
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  targetId: string;
}

export function useBrowserFind({
  adapter,
  webview,
  containerRef,
  enabled,
  targetId,
}: UseBrowserFindOptions) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<FindSearchStatus>(EMPTY_SEARCH_STATUS);
  // findInPage() is async and re-scans the whole page per call, so typing
  // quickly issues several overlapping requests whose found-in-page results
  // can resolve out of order — a short, fast-to-resolve query (e.g. "i")
  // can arrive after a longer one that's still running, leaving stale
  // highlighting on screen for whatever query happened to finish last. Only
  // accept a result if it matches the most recently issued request.
  const latestRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!webview) return;
    const onFoundInPage = (event: { result: Electron.FoundInPageResult }) => {
      if (event.result.requestId !== latestRequestIdRef.current) return;
      const { activeMatchOrdinal, matches } = event.result;
      setSearchStatus({ found: matches > 0, currentIndex: activeMatchOrdinal, total: matches });
    };
    webview.addEventListener('found-in-page', onFoundInPage);
    return () => webview.removeEventListener('found-in-page', onFoundInPage);
  }, [webview]);

  const resetSearchState = useCallback(() => {
    setSearchQuery('');
    setSearchStatus(EMPTY_SEARCH_STATUS);
    setIsSearchOpen(false);
  }, []);

  const closeSearch = useCallback(() => {
    adapter?.stopFind('clearSelection');
    resetSearchState();
  }, [adapter, resetSearchState]);

  const openSearch = useCallback(() => {
    if (!enabled) return;
    setIsSearchOpen(true);
  }, [enabled]);

  const handleSearchQueryChange = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      if (!nextQuery) {
        latestRequestIdRef.current = null;
        adapter?.stopFind('clearSelection');
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }
      // Electron's findNext option is misleadingly named: per its own docs,
      // it must be true to "begin a new text finding session" (i.e. for a
      // changed query) and false for a "follow-up request" continuing the
      // existing session (i.e. stepping through matches of the same query).
      // Getting this backwards means a new query never actually resets the
      // search — it just keeps matching whatever the very first query locked
      // onto, which looks like typing is "stuck" until Enter forces a step
      // that happens to start a fresh session.
      const requestId = adapter?.find(nextQuery, { forward: true, findNext: true });
      if (requestId !== undefined) latestRequestIdRef.current = requestId;
    },
    [adapter]
  );

  const stepSearch = useCallback(
    (direction: 'next' | 'prev') => {
      if (!searchQuery) return;
      const requestId = adapter?.find(searchQuery, {
        forward: direction === 'next',
        findNext: false,
      });
      if (requestId !== undefined) latestRequestIdRef.current = requestId;
    },
    [adapter, searchQuery]
  );

  const handleFindActivate = useCallback(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    openSearch();
  }, [isSearchOpen, openSearch]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!enabled || !adapter) return;
    return findTargetRegistry.register({ id: targetId, openFind: handleFindActivate });
  }, [adapter, enabled, handleFindActivate, targetId]);

  useFindTargetActivation({ containerRef, targetId, enabled });

  return {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  };
}
