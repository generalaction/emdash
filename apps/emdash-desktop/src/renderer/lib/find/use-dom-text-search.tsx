import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  collectTextNodeMatches,
  getNextDomMatchIndex,
  getTextNodeAtIndex,
  type DomSearchMatch,
} from './dom-text-search';
import { findTargetRegistry } from './find-target-registry';
import type { FindSearchStatus } from './types';
import { useFindTargetActivation } from './use-find-target-activation';

const EMPTY_SEARCH_STATUS: FindSearchStatus = {
  found: false,
  currentIndex: 0,
  total: 0,
};

const MARK_ATTR = 'data-find-current';

interface UseDomTextSearchOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  targetId: string;
  onCloseFocus?: () => void;
}

export function useDomTextSearch({
  containerRef,
  enabled,
  targetId,
  onCloseFocus,
}: UseDomTextSearchOptions) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const markRef = useRef<HTMLElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [searchStatus, setSearchStatus] = useState<FindSearchStatus>(EMPTY_SEARCH_STATUS);

  const clearMark = useCallback(() => {
    const mark = markRef.current;
    if (!mark?.parentNode) return;
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
    markRef.current = null;
  }, []);

  const resetSearchState = useCallback(() => {
    setSearchQuery('');
    setSearchStatus(EMPTY_SEARCH_STATUS);
    setCurrentMatchIndex(-1);
    setIsSearchOpen(false);
  }, []);

  const applyMatch = useCallback(
    (match: DomSearchMatch) => {
      const container = containerRef.current;
      if (!container) return;

      clearMark();

      const textNode = getTextNodeAtIndex(container, match.nodeIndex);
      if (!textNode) return;

      const range = document.createRange();
      range.setStart(textNode, match.start);
      range.setEnd(textNode, match.start + match.length);

      const mark = document.createElement('mark');
      mark.setAttribute(MARK_ATTR, 'true');
      mark.className = 'text-inherit';
      mark.style.backgroundColor = 'var(--find-match-highlight-bg)';
      range.surroundContents(mark);
      markRef.current = mark;

      mark.scrollIntoView({ block: 'center' });
    },
    [clearMark, containerRef]
  );

  const runSearch = useCallback(
    (
      query: string,
      options: { direction?: 'next' | 'prev'; reset?: boolean } = {}
    ): FindSearchStatus => {
      const container = containerRef.current;
      if (!enabled || !container || !query) {
        clearMark();
        setSearchStatus(EMPTY_SEARCH_STATUS);
        setCurrentMatchIndex(-1);
        return EMPTY_SEARCH_STATUS;
      }

      // Clear any existing mark first — collectTextNodeMatches must see the
      // DOM without a previous <mark> wrapper splitting a text node, or the
      // nodeIndex/offsets it computes won't line up once applyMatch clears
      // that mark itself.
      clearMark();

      const matches = collectTextNodeMatches(container, query);
      if (matches.length === 0) {
        clearMark();
        setCurrentMatchIndex(-1);
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return EMPTY_SEARCH_STATUS;
      }

      const direction = options.direction ?? 'next';
      const baseIndex = options.reset ? -1 : currentMatchIndex;
      const nextIndex = getNextDomMatchIndex(matches, baseIndex, direction);
      const match = matches[nextIndex];

      applyMatch(match);
      setCurrentMatchIndex(nextIndex);

      const result: FindSearchStatus = {
        found: true,
        currentIndex: nextIndex + 1,
        total: matches.length,
      };
      setSearchStatus(result);
      return result;
    },
    [applyMatch, clearMark, containerRef, currentMatchIndex, enabled]
  );

  const closeSearch = useCallback(() => {
    clearMark();
    resetSearchState();
    onCloseFocus?.();
  }, [clearMark, onCloseFocus, resetSearchState]);

  const openSearch = useCallback(() => {
    if (!enabled) return;
    setIsSearchOpen(true);
  }, [enabled]);

  const handleSearchQueryChange = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      if (!nextQuery) {
        clearMark();
        setCurrentMatchIndex(-1);
        setSearchStatus(EMPTY_SEARCH_STATUS);
        return;
      }
      runSearch(nextQuery, { direction: 'next', reset: true });
    },
    [clearMark, runSearch]
  );

  const stepSearch = useCallback(
    (direction: 'next' | 'prev') => {
      if (!searchQuery) return;
      runSearch(searchQuery, { direction, reset: false });
    },
    [runSearch, searchQuery]
  );

  useEffect(() => {
    if (!isSearchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isSearchOpen]);

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

  useEffect(() => {
    return () => clearMark();
  }, [clearMark]);

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
