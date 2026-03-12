import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';

export type TerminalSearchStatus = {
  found: boolean;
  currentIndex: number;
  total: number;
};

const EMPTY_SEARCH_STATUS: TerminalSearchStatus = {
  found: false,
  currentIndex: 0,
  total: 0,
};
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

interface UseTerminalSearchOptions {
  terminalId: string | null | undefined;
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onCloseFocus?: () => void;
}

export function useTerminalSearch({
  terminalId,
  containerRef,
  enabled,
  onCloseFocus,
}: UseTerminalSearchOptions) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchedTerminalIdRef = useRef<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<TerminalSearchStatus>(EMPTY_SEARCH_STATUS);

  const clearSearchSelection = useCallback((sessionId?: string | null) => {
    const id = sessionId ?? searchedTerminalIdRef.current;
    if (!id) return;
    terminalSessionRegistry.getSession(id)?.clearSearch();
    if (searchedTerminalIdRef.current === id) {
      searchedTerminalIdRef.current = null;
    }
  }, []);

  const runTerminalSearch = useCallback(
    (
      query: string,
      options: {
        direction?: 'next' | 'prev';
        reset?: boolean;
      } = {}
    ): TerminalSearchStatus => {
      if (!enabled || !terminalId) {
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      if (searchedTerminalIdRef.current && searchedTerminalIdRef.current !== terminalId) {
        clearSearchSelection(searchedTerminalIdRef.current);
      }

      const session = terminalSessionRegistry.getSession(terminalId);
      if (!session) {
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      const result = session.search(query, options);
      searchedTerminalIdRef.current = terminalId;
      setSearchStatus(result);
      return result;
    },
    [clearSearchSelection, enabled, terminalId]
  );

  const closeSearch = useCallback(() => {
    clearSearchSelection();
    setSearchQuery('');
    setSearchStatus(EMPTY_SEARCH_STATUS);
    setIsSearchOpen(false);
    onCloseFocus?.();
  }, [clearSearchSelection, onCloseFocus]);

  const openSearch = useCallback(() => {
    if (!enabled) return;
    setIsSearchOpen(true);
  }, [enabled]);

  const handleSearchQueryChange = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      if (!nextQuery) {
        clearSearchSelection();
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }
      runTerminalSearch(nextQuery, { direction: 'next', reset: true });
    },
    [clearSearchSelection, runTerminalSearch]
  );

  const stepSearch = useCallback(
    (direction: 'next' | 'prev') => {
      if (!searchQuery) return;
      runTerminalSearch(searchQuery, { direction, reset: false });
    },
    [runTerminalSearch, searchQuery]
  );

  useEffect(() => {
    if (!isSearchOpen) return;
    const focusTimer = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(focusTimer);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!enabled && isSearchOpen) {
      closeSearch();
    }
  }, [closeSearch, enabled, isSearchOpen]);

  useEffect(() => {
    if (searchedTerminalIdRef.current && searchedTerminalIdRef.current !== terminalId) {
      clearSearchSelection(searchedTerminalIdRef.current);
      setSearchStatus(EMPTY_SEARCH_STATUS);
    }
  }, [clearSearchSelection, terminalId]);

  useEffect(() => {
    if (!enabled || !isSearchOpen || !searchQuery || !terminalId) {
      return;
    }
    runTerminalSearch(searchQuery, { direction: 'next', reset: true });
  }, [enabled, isSearchOpen, runTerminalSearch, searchQuery, terminalId]);

  useEffect(() => {
    if (!enabled) return;

    const handleSearchShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasPlatformModifier = IS_MAC_PLATFORM
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!hasPlatformModifier || event.altKey || event.shiftKey || key !== 'f') {
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      const activeElement = document.activeElement;
      if (!activeElement || !container.contains(activeElement)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      openSearch();
    };

    window.addEventListener('keydown', handleSearchShortcut, true);
    return () => window.removeEventListener('keydown', handleSearchShortcut, true);
  }, [containerRef, enabled, openSearch]);

  useEffect(() => {
    return () => {
      clearSearchSelection();
    };
  }, [clearSearchSelection]);

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
