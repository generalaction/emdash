import { BROWSER_DEFAULT_SEARCH_URL } from './browser';
import {
  browserBookmarkDisplayTitle,
  browserBookmarkFaviconUrl,
  type BrowserBookmark,
} from './browser-bookmarks';

export type BrowserUrlBookmarkSuggestion = {
  type: 'bookmark';
  id: string;
  title: string;
  url: string;
  faviconUrl: string | null;
};

export type BrowserUrlSearchSuggestion = {
  type: 'search';
  query: string;
  url: string;
};

export type BrowserUrlSuggestion = BrowserUrlBookmarkSuggestion | BrowserUrlSearchSuggestion;

export function buildBrowserSearchNavigationUrl(query: string): string {
  const url = new URL(BROWSER_DEFAULT_SEARCH_URL);
  url.searchParams.set('q', query);
  return url.toString();
}

export function browserUrlSuggestionTarget(suggestion: BrowserUrlSuggestion): string {
  return suggestion.url;
}

export function buildBrowserUrlSuggestions(
  query: string,
  bookmarks: readonly BrowserBookmark[],
  options: { maxBookmarks?: number } = {}
): BrowserUrlSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const maxBookmarks = options.maxBookmarks ?? 6;
  const bookmarkSuggestions = bookmarks
    .map((bookmark) => ({
      bookmark,
      score: bookmarkMatchScore(bookmark, trimmed),
    }))
    .filter((entry): entry is { bookmark: BrowserBookmark; score: number } => entry.score !== null)
    .sort(
      (left, right) =>
        left.score - right.score || left.bookmark.url.localeCompare(right.bookmark.url)
    )
    .slice(0, maxBookmarks)
    .map(({ bookmark }) => toBookmarkSuggestion(bookmark));

  return [
    ...bookmarkSuggestions,
    {
      type: 'search',
      query: trimmed,
      url: buildBrowserSearchNavigationUrl(trimmed),
    },
  ];
}

export function browserUrlSuggestionDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const suffix = `${parsed.search}${parsed.hash}`;
    return `${host}${path}${suffix}`;
  } catch {
    return url;
  }
}

function toBookmarkSuggestion(bookmark: BrowserBookmark): BrowserUrlBookmarkSuggestion {
  return {
    type: 'bookmark',
    id: bookmark.id,
    title: browserBookmarkDisplayTitle(bookmark),
    url: bookmark.url,
    faviconUrl: browserBookmarkFaviconUrl(bookmark),
  };
}

function bookmarkMatchScore(bookmark: BrowserBookmark, query: string): number | null {
  const normalizedQuery = query.toLowerCase();
  const title = browserBookmarkDisplayTitle(bookmark).toLowerCase();
  const url = bookmark.url.toLowerCase();
  const hostname = bookmarkHostname(bookmark).toLowerCase();

  if (title.startsWith(normalizedQuery)) return 0;
  if (hostname.startsWith(normalizedQuery)) return 1;
  if (url.startsWith(normalizedQuery)) return 2;
  if (title.includes(normalizedQuery)) return 3;
  if (hostname.includes(normalizedQuery)) return 4;
  if (url.includes(normalizedQuery)) return 5;
  return null;
}

function bookmarkHostname(bookmark: BrowserBookmark): string {
  try {
    return new URL(bookmark.url).hostname.replace(/^www\./, '');
  } catch {
    return bookmark.url;
  }
}
