import { describe, expect, it } from 'vitest';
import { BrowserSessionStore } from './browser-session-store';

describe('BrowserSessionStore', () => {
  it('creates isolated sessions with normalized initial URLs', () => {
    const store = new BrowserSessionStore();

    const session = store.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'localhost:5173',
    });

    expect(session.currentUrl).toBe('http://localhost:5173/');
    expect(session.profileId).toBe('default');
    expect(session.partition).toBe('persist:emdash-browser-profile-default');
    expect(store.getSession('browser-1')).toEqual(session);
  });

  it('updates mutable browser state while preserving URL on rejected navigation', () => {
    const store = new BrowserSessionStore();
    store.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      initialUrl: 'https://example.com',
    });

    const updated = store.updateSession('browser-1', {
      currentUrl: 'javascript:alert(1)',
      title: 'Example',
      canGoBack: true,
    });

    expect(updated).toMatchObject({
      currentUrl: 'https://example.com/',
      title: 'Example',
      canGoBack: true,
    });
  });

  it('clears favicon state explicitly', () => {
    const store = new BrowserSessionStore();
    store.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    store.updateSession('browser-1', { faviconUrl: 'https://example.com/favicon.ico' });
    store.updateSession('browser-1', { faviconUrl: null });

    expect(store.getSession('browser-1')?.faviconUrl).toBeUndefined();
  });

  it('restores sessions onto their profile partition and clears transient load state', () => {
    const store = new BrowserSessionStore();

    store.restoreSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      profileId: 'work',
      partition: 'persist:wrong',
      currentUrl: 'example.com',
      title: 'Example',
      isLoading: true,
      canGoBack: true,
      canGoForward: false,
      loadError: { description: 'stale failure' },
      createdAt: 100,
      updatedAt: 100,
    });

    expect(store.getSession('browser-1')).toMatchObject({
      profileId: 'work',
      partition: 'persist:emdash-browser-profile-work',
      currentUrl: 'https://example.com/',
      isLoading: false,
      loadError: undefined,
    });
  });

  it('falls back to the default profile when restoring invalid profile ids', () => {
    const store = new BrowserSessionStore();

    store.restoreSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      profileId: '../not-safe',
      partition: 'persist:wrong',
      currentUrl: 'about:blank',
      title: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      createdAt: 100,
      updatedAt: 100,
    });

    expect(store.getSession('browser-1')).toMatchObject({
      profileId: 'default',
      partition: 'persist:emdash-browser-profile-default',
    });
  });

  it('removes sessions explicitly', () => {
    const store = new BrowserSessionStore();
    store.createSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    store.removeSession('browser-1');

    expect(store.getSession('browser-1')).toBeUndefined();
  });
});
