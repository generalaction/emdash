import type { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { findTargetRegistry } from '@renderer/lib/find/find-target-registry';
import type { FindSearchStatus } from '@renderer/lib/find/types';
import { useFindTargetActivation } from '@renderer/lib/find/use-find-target-activation';
import {
  collectTerminalSearchMatches,
  getNextTerminalSearchIndex,
  type TerminalSearchBufferLike,
  type TerminalSearchMatch,
} from './terminal-search';

export type TerminalSearchStatus = FindSearchStatus;

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const EMPTY_SEARCH_STATUS: TerminalSearchStatus = {
  found: false,
  currentIndex: 0,
  total: 0,
};

interface UseTerminalSearchOptions {
  terminal: Terminal | null | undefined;
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  targetId: string;
  onCloseFocus?: () => void;
}

export function useTerminalSearch({
  terminal,
  containerRef,
  enabled,
  targetId,
  onCloseFocus,
}: UseTerminalSearchOptions) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchedTerminalRef = useRef<Terminal | null>(null);
  const activeSearchQueryRef = useRef('');
  const activeSearchMatchRef = useRef<TerminalSearchMatch | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<TerminalSearchStatus>(EMPTY_SEARCH_STATUS);

  const resetSearchState = useCallback(() => {
    setSearchQuery('');
    setSearchStatus(EMPTY_SEARCH_STATUS);
    setIsSearchOpen(false);
  }, []);

  const clearTerminalSelection = useCallback((target?: Terminal | null) => {
    const candidate = target ?? searchedTerminalRef.current;
    if (!candidate) return;
    try {
      candidate.clearSelection();
    } catch {}
    if (candidate === searchedTerminalRef.current) {
      searchedTerminalRef.current = null;
      activeSearchQueryRef.current = '';
      activeSearchMatchRef.current = null;
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
      if (!enabled || !terminal) {
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      if (searchedTerminalRef.current && searchedTerminalRef.current !== terminal) {
        clearTerminalSelection(searchedTerminalRef.current);
      }

      if (!query) {
        clearTerminalSelection(terminal);
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      const buffer = terminal.buffer?.active as TerminalSearchBufferLike | undefined;
      if (!buffer) {
        searchedTerminalRef.current = terminal;
        activeSearchQueryRef.current = query;
        activeSearchMatchRef.current = null;
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      const matches = collectTerminalSearchMatches(buffer, query);
      if (matches.length === 0) {
        searchedTerminalRef.current = terminal;
        activeSearchQueryRef.current = query;
        activeSearchMatchRef.current = null;
        try {
          terminal.clearSelection();
        } catch {}
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      const direction = options.direction ?? 'next';
      const currentMatch =
        !options.reset && activeSearchQueryRef.current === query
          ? activeSearchMatchRef.current
          : null;
      const matchIndex = getNextTerminalSearchIndex(matches, currentMatch, direction);
      const match = matches[matchIndex];

      searchedTerminalRef.current = terminal;
      activeSearchQueryRef.current = query;
      activeSearchMatchRef.current = match;

      try {
        terminal.select(match.col, match.row, match.length);
        const contextRows = Math.max(0, Math.floor(terminal.rows / 2));
        terminal.scrollToLine(Math.max(0, match.row - contextRows));
      } catch {}

      const result = {
        found: true,
        currentIndex: matchIndex + 1,
        total: matches.length,
      };
      setSearchStatus(result);
      return result;
    },
    [clearTerminalSelection, enabled, terminal]
  );

  const closeSearch = useCallback(() => {
    clearTerminalSelection();
    resetSearchState();
    onCloseFocus?.();
  }, [clearTerminalSelection, onCloseFocus, resetSearchState]);

  const openSearch = useCallback(() => {
    if (!enabled) return;
    setIsSearchOpen(true);
  }, [enabled]);

  const handleSearchQueryChange = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      if (!nextQuery) {
        clearTerminalSelection();
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }
      runTerminalSearch(nextQuery, { direction: 'next', reset: true });
    },
    [clearTerminalSelection, runTerminalSearch]
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
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isSearchOpen]);

  useEffect(() => {
    if (enabled || !isSearchOpen) return;
    const id = requestAnimationFrame(() => {
      clearTerminalSelection();
      resetSearchState();
      onCloseFocus?.();
    });
    return () => cancelAnimationFrame(id);
  }, [clearTerminalSelection, enabled, isSearchOpen, onCloseFocus, resetSearchState]);

  useEffect(() => {
    if (searchedTerminalRef.current && searchedTerminalRef.current !== terminal) {
      const id = requestAnimationFrame(() => {
        clearTerminalSelection(searchedTerminalRef.current);
        setSearchStatus(EMPTY_SEARCH_STATUS);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [clearTerminalSelection, terminal]);

  useEffect(() => {
    if (!enabled || !isSearchOpen || !searchQuery || !terminal) return;
    const id = requestAnimationFrame(() => {
      runTerminalSearch(searchQuery, { direction: 'next', reset: true });
    });
    return () => cancelAnimationFrame(id);
  }, [enabled, isSearchOpen, runTerminalSearch, searchQuery, terminal]);

  const handleFindActivate = useCallback(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    openSearch();
  }, [isSearchOpen, openSearch]);

  useEffect(() => {
    if (!enabled) return;
    return findTargetRegistry.register({ id: targetId, openFind: handleFindActivate });
  }, [enabled, handleFindActivate, targetId]);

  useFindTargetActivation({ containerRef, targetId, enabled });

  // xterm's own key handler (see Terminal.attachCustomKeyEventHandler in
  // use-pty.ts) calls stopPropagation() on keydown while its hidden textarea
  // is focused, which prevents the bubble-phase CommandShortcutBinder hotkey
  // from ever seeing Cmd/Ctrl+F. Intercept it here at capture phase — same
  // trick monaco-keyboard-bridge.tsx uses for Monaco — so find still opens
  // while a terminal has focus.
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

      findTargetRegistry.setActive(targetId);
      handleFindActivate();
    };

    window.addEventListener('keydown', handleSearchShortcut, true);
    return () => window.removeEventListener('keydown', handleSearchShortcut, true);
  }, [containerRef, enabled, handleFindActivate, targetId]);

  useEffect(() => {
    return () => clearTerminalSelection();
  }, [clearTerminalSelection]);

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
