import { BROWSER_DEFAULT_URL, normalizeBrowserUrl } from './browser';

export type BrowserBookmark = {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
};

export function bookmarkTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function normalizeBrowserBookmarkUrl(url: string): string | null {
  const normalized = normalizeBrowserUrl(url, { allowSearchQueries: false });
  if (!normalized.ok) return null;

  try {
    const parsed = new URL(normalized.url);
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function browserBookmarkUrlsMatch(a: string, b: string): boolean {
  const left = normalizeBrowserBookmarkUrl(a);
  const right = normalizeBrowserBookmarkUrl(b);
  return left !== null && left === right;
}

export function findBrowserBookmarkForUrl(
  bookmarks: readonly BrowserBookmark[],
  url: string
): BrowserBookmark | undefined {
  return bookmarks.find((bookmark) => browserBookmarkUrlsMatch(bookmark.url, url));
}

export function isBrowserBookmarkableUrl(url: string): boolean {
  const normalized = normalizeBrowserBookmarkUrl(url);
  return normalized !== null && normalized !== BROWSER_DEFAULT_URL;
}

export function browserBookmarkDisplayTitle(bookmark: BrowserBookmark): string {
  const title = bookmark.title.trim();
  return title.length > 0 ? title : bookmarkTitleFromUrl(bookmark.url);
}

export function browserBookmarkFaviconUrl(bookmark: BrowserBookmark): string | null {
  return bookmark.faviconUrl ?? null;
}

export function createBrowserBookmark(input: {
  url: string;
  title?: string;
  faviconUrl?: string;
  id?: string;
}): BrowserBookmark | null {
  const url = normalizeBrowserBookmarkUrl(input.url);
  if (!url) return null;

  return {
    id: input.id ?? crypto.randomUUID(),
    url,
    title: input.title?.trim() || bookmarkTitleFromUrl(url),
    faviconUrl: input.faviconUrl,
  };
}

export function createBrowserBookmarkFromSession(input: {
  currentUrl: string;
  title: string;
  faviconUrl?: string;
}): BrowserBookmark | null {
  return createBrowserBookmark({
    url: input.currentUrl,
    title: input.title.trim() || undefined,
    faviconUrl: input.faviconUrl,
  });
}

export function upsertBrowserBookmark(
  bookmarks: readonly BrowserBookmark[],
  bookmark: BrowserBookmark
): BrowserBookmark[] {
  const existing = findBrowserBookmarkForUrl(bookmarks, bookmark.url);
  if (existing) {
    return bookmarks.map((candidate) =>
      candidate.id === existing.id
        ? {
            ...candidate,
            title: bookmark.title,
            faviconUrl: bookmark.faviconUrl ?? candidate.faviconUrl,
          }
        : candidate
    );
  }
  return [...bookmarks, bookmark];
}

export function removeBrowserBookmark(
  bookmarks: readonly BrowserBookmark[],
  bookmarkId: string
): BrowserBookmark[] {
  return bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
}

export function reorderBrowserBookmarks(
  bookmarks: readonly BrowserBookmark[],
  fromIndex: number,
  toIndex: number
): BrowserBookmark[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return [...bookmarks];
  if (fromIndex >= bookmarks.length || toIndex >= bookmarks.length) return [...bookmarks];

  const next = [...bookmarks];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return [...bookmarks];
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderBrowserBookmarksToMatch(
  bookmarks: readonly BrowserBookmark[],
  orderedBookmarks: readonly BrowserBookmark[]
): BrowserBookmark[] {
  if (bookmarks.length !== orderedBookmarks.length) return [...bookmarks];
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  if (orderedBookmarks.some((bookmark) => !bookmarkIds.has(bookmark.id))) {
    return [...bookmarks];
  }
  return [...orderedBookmarks];
}

export function toggleBrowserBookmarkForSession(
  bookmarks: readonly BrowserBookmark[],
  input: { currentUrl: string; title: string; faviconUrl?: string }
): { bookmarks: BrowserBookmark[]; bookmarked: boolean } {
  const existing = findBrowserBookmarkForUrl(bookmarks, input.currentUrl);
  if (existing) {
    return {
      bookmarks: removeBrowserBookmark(bookmarks, existing.id),
      bookmarked: false,
    };
  }

  const bookmark = createBrowserBookmarkFromSession(input);
  if (!bookmark) {
    return { bookmarks: [...bookmarks], bookmarked: false };
  }

  return {
    bookmarks: upsertBrowserBookmark(bookmarks, bookmark),
    bookmarked: true,
  };
}
