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
    expect(session.partition).toBe('persist:emdash-browser-project-1-workspace-1-task-1-browser-1');
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

  it('restores sessions with a derived partition and clears transient load state', () => {
    const store = new BrowserSessionStore();

    store.restoreSession({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
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
      partition: 'persist:emdash-browser-project-1-workspace-1-task-1-browser-1',
      currentUrl: 'https://example.com/',
      isLoading: false,
      loadError: undefined,
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
