import { useState, useCallback, useRef, useEffect } from 'react';

// Constants - No magic numbers
const SEARCH_DEBOUNCE_MS = 400; // Balanced for performance and responsiveness
const DEFAULT_MAX_RESULTS = 100; // Good coverage without overwhelming UI
const MIN_SEARCH_LENGTH = 2; // Minimum 2 characters to search

// Types
export interface SearchMatch {
  line: number;
  column: number;
  text: string;
  preview: string;
}

export interface SearchResult {
  file: string;
  matches: SearchMatch[];
}

export interface UseContentSearchOptions {
  debounceMs?: number;
  maxResults?: number;
  caseSensitive?: boolean;
}

export interface UseContentSearchReturn {
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  error: string | null;
  handleSearchChange: (value: string) => void;
  clearSearch: () => void;
}

/**
 * Custom hook for content search functionality
 * Encapsulates search logic with debouncing and error handling
 */
export function useContentSearch(
  rootPath: string,
  options: UseContentSearchOptions = {}
): UseContentSearchReturn {
  const {
    debounceMs = SEARCH_DEBOUNCE_MS,
    maxResults = DEFAULT_MAX_RESULTS,
    caseSensitive = false,
  } = options;

  // State management
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to store debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Perform the actual search
  const performSearch = useCallback(
    async (query: string) => {
      setIsSearching(true);
      setError(null);

      try {
        const result = await window.electronAPI.fsSearchContent(rootPath, query, {
          caseSensitive,
          maxResults,
        });

        if (!result.success) {
          throw new Error(result.error || 'Search failed');
        }

        setSearchResults(result.results || []);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(errorMessage);
        setSearchResults([]);
        console.error('Content search failed:', err);
      } finally {
        setIsSearching(false);
      }
    },
    [rootPath, caseSensitive, maxResults]
  );

  // Handle search input changes with debouncing
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);

      // Clear previous timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Clear results if search is too short
      if (value.trim().length < MIN_SEARCH_LENGTH) {
        setSearchResults([]);
        setError(null);
        return;
      }

      // Set up new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        performSearch(value);
      }, debounceMs);
    },
    [performSearch, debounceMs]
  );

  // Clear search state
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setError(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  return {
    searchQuery,
    searchResults,
    isSearching,
    error,
    handleSearchChange,
    clearSearch,
  };
}
