import { describe, expect, it } from 'vitest';
import {
  browserBookmarkUrlsMatch,
  createBrowserBookmark,
  findBrowserBookmarkForUrl,
  isBrowserBookmarkableUrl,
  normalizeBrowserBookmarkUrl,
  removeBrowserBookmark,
  toggleBrowserBookmarkForSession,
  upsertBrowserBookmark,
} from './browser-bookmarks';

describe('browser bookmarks', () => {
  it('normalizes bookmark urls by stripping hash and trailing slash', () => {
    expect(normalizeBrowserBookmarkUrl('https://example.com/docs/')).toBe(
      'https://example.com/docs'
    );
    expect(normalizeBrowserBookmarkUrl('https://example.com/docs#section')).toBe(
      'https://example.com/docs'
    );
  });

  it('matches equivalent bookmark urls', () => {
    expect(
      browserBookmarkUrlsMatch('https://example.com/docs/', 'https://example.com/docs#intro')
    ).toBe(true);
  });

  it('rejects non-navigable urls for bookmarks', () => {
    expect(isBrowserBookmarkableUrl('about:blank')).toBe(false);
    expect(isBrowserBookmarkableUrl('https://example.com')).toBe(true);
  });

  it('upserts bookmarks by url', () => {
    const bookmark = createBrowserBookmark({
      id: '11111111-1111-4111-8111-111111111111',
      url: 'https://example.com',
      title: 'Example',
    });
    expect(bookmark).not.toBeNull();

    const next = upsertBrowserBookmark([], bookmark!);
    expect(next).toHaveLength(1);

    const updated = upsertBrowserBookmark(next, {
      ...bookmark!,
      title: 'Example Docs',
      faviconUrl: 'https://example.com/favicon.ico',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.title).toBe('Example Docs');
    expect(updated[0]?.faviconUrl).toBe('https://example.com/favicon.ico');
  });

  it('toggles bookmarks for the current session url', () => {
    const added = toggleBrowserBookmarkForSession([], {
      currentUrl: 'https://example.com/docs',
      title: 'Docs',
      faviconUrl: 'https://example.com/favicon.ico',
    });
    expect(added.bookmarked).toBe(true);
    expect(added.bookmarks).toHaveLength(1);

    const removed = toggleBrowserBookmarkForSession(added.bookmarks, {
      currentUrl: 'https://example.com/docs/',
      title: 'Docs',
    });
    expect(removed.bookmarked).toBe(false);
    expect(removed.bookmarks).toHaveLength(0);
  });

  it('finds and removes bookmarks by id', () => {
    const bookmark = createBrowserBookmark({
      id: '11111111-1111-4111-8111-111111111111',
      url: 'https://github.com',
      title: 'GitHub',
    });
    const bookmarks = bookmark ? [bookmark] : [];
    expect(findBrowserBookmarkForUrl(bookmarks, 'https://github.com/')?.id).toBe(bookmark?.id);
    expect(removeBrowserBookmark(bookmarks, bookmark!.id)).toEqual([]);
  });
});
