import { describe, expect, it } from 'vitest';
import {
  browserBookmarkUrlsMatch,
  createBrowserBookmark,
  findBrowserBookmarkForUrl,
  isBrowserBookmarkableUrl,
  normalizeBrowserBookmarkUrl,
  removeBrowserBookmark,
  reorderBrowserBookmarks,
  reorderBrowserBookmarksToMatch,
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

  it('reorders bookmarks by index', () => {
    const first = createBrowserBookmark({
      id: '11111111-1111-4111-8111-111111111111',
      url: 'https://example.com',
      title: 'Example',
    });
    const second = createBrowserBookmark({
      id: '22222222-2222-4222-8222-222222222222',
      url: 'https://github.com',
      title: 'GitHub',
    });
    const third = createBrowserBookmark({
      id: '33333333-3333-4333-8333-333333333333',
      url: 'https://google.com',
      title: 'Google',
    });
    const bookmarks = [first!, second!, third!];

    expect(reorderBrowserBookmarks(bookmarks, 0, 2).map((bookmark) => bookmark.id)).toEqual([
      second!.id,
      third!.id,
      first!.id,
    ]);
  });

  it('accepts only valid reorder results', () => {
    const first = createBrowserBookmark({
      id: '11111111-1111-4111-8111-111111111111',
      url: 'https://example.com',
      title: 'Example',
    });
    const second = createBrowserBookmark({
      id: '22222222-2222-4222-8222-222222222222',
      url: 'https://github.com',
      title: 'GitHub',
    });
    const bookmarks = [first!, second!];

    expect(reorderBrowserBookmarksToMatch(bookmarks, [second!, first!])).toEqual([second, first]);
    expect(reorderBrowserBookmarksToMatch(bookmarks, [first!, second!, first!])).toEqual(bookmarks);
  });
});
