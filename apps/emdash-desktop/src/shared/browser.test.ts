import { describe, expect, it } from 'vitest';
import {
  createBrowserSessionSnapshot,
  deriveBrowserPartition,
  makeBrowserSessionIdentity,
  normalizeBrowserUrl,
} from './browser';

describe('normalizeBrowserUrl', () => {
  it('defaults localhost-like inputs to http', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toEqual({
      ok: true,
      url: 'http://localhost:5173/',
      protocol: 'http:',
    });
    expect(normalizeBrowserUrl('127.0.0.1:3000/app')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:3000/app',
      protocol: 'http:',
    });
  });

  it('defaults public domains to https', () => {
    expect(normalizeBrowserUrl('example.com/path')).toEqual({
      ok: true,
      url: 'https://example.com/path',
      protocol: 'https:',
    });
  });

  it('allows about blank and blocks unsupported protocols', () => {
    expect(normalizeBrowserUrl('about:blank')).toEqual({
      ok: true,
      url: 'about:blank',
      protocol: 'about:',
    });
    expect(normalizeBrowserUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
    expect(normalizeBrowserUrl('data:text/html,hello')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });

  it('blocks file URLs unless explicitly allowed', () => {
    expect(normalizeBrowserUrl('file:///tmp/index.html')).toEqual({
      ok: false,
      reason: 'unsupported-file-url',
    });
    expect(normalizeBrowserUrl('file:///tmp/index.html', { allowFileUrls: true })).toEqual({
      ok: true,
      url: 'file:///tmp/index.html',
      protocol: 'file:',
    });
  });
});

describe('browser session identity', () => {
  it('derives sanitized persistent partitions from stable identity', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'Browser One',
      projectId: 'Project/One',
      workspaceId: 'Workspace.One',
      taskId: 'Task One',
    });

    expect(deriveBrowserPartition(identity)).toBe(
      'persist:emdash-browser-project-one-workspace-one-task-one-browser-one'
    );
  });

  it('creates safe snapshots with normalized URLs', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    expect(
      createBrowserSessionSnapshot({
        identity,
        currentUrl: 'javascript:alert(1)',
        now: 100,
      })
    ).toMatchObject({
      browserId: 'browser-1',
      currentUrl: 'about:blank',
      createdAt: 100,
      updatedAt: 100,
    });
  });
});
