import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_ZOOM_FACTOR,
  BROWSER_ZOOM_FACTORS,
  canZoomIn,
  canZoomOut,
  createBrowserSessionSnapshot,
  deriveBrowserPartition,
  formatBrowserZoomPercent,
  isBrowserDataClearKind,
  isDefaultBrowserZoomFactor,
  makeBrowserSessionIdentity,
  nextBrowserZoomFactor,
  normalizeBrowserZoomFactor,
  normalizeBrowserUrl,
  previousBrowserZoomFactor,
} from './browser';

const MIN_ZOOM = BROWSER_ZOOM_FACTORS[0];
const MAX_ZOOM = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1];

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

  it('uses Google search for non-URL input', () => {
    expect(normalizeBrowserUrl('react compiler')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=react+compiler',
      protocol: 'https:',
    });
    expect(normalizeBrowserUrl('vitest')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=vitest',
      protocol: 'https:',
    });
    expect(normalizeBrowserUrl('react: useState')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=react%3A+useState',
      protocol: 'https:',
    });
  });

  it('can reject search-like inputs when validating actual navigation URLs', () => {
    expect(normalizeBrowserUrl('react: useState', { allowSearchQueries: false })).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
    expect(normalizeBrowserUrl('mailto: user@example.com', { allowSearchQueries: false })).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
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
      zoomFactor: 1,
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it('preserves bare host URLs in snapshots', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    expect(
      createBrowserSessionSnapshot({
        identity,
        currentUrl: 'intranet',
        now: 100,
      })
    ).toMatchObject({
      currentUrl: 'https://intranet/',
    });
  });
});

describe('browser data clearing', () => {
  it('validates supported clear kinds', () => {
    expect(isBrowserDataClearKind('storage')).toBe(true);
    expect(isBrowserDataClearKind('cookies')).toBe(true);
    expect(isBrowserDataClearKind('cache')).toBe(true);
    expect(isBrowserDataClearKind('everything')).toBe(false);
  });
});

describe('browser zoom', () => {
  it('normalizes missing and invalid factors to the default', () => {
    expect(normalizeBrowserZoomFactor(undefined)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
    expect(normalizeBrowserZoomFactor(Number.NaN)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
    expect(normalizeBrowserZoomFactor(Number.POSITIVE_INFINITY)).toBe(BROWSER_DEFAULT_ZOOM_FACTOR);
  });

  it('clamps factors to the supported range', () => {
    expect(normalizeBrowserZoomFactor(0.01)).toBe(MIN_ZOOM);
    expect(normalizeBrowserZoomFactor(50)).toBe(MAX_ZOOM);
    expect(normalizeBrowserZoomFactor(1.5)).toBe(1.5);
  });

  it('steps to the next and previous preset factor', () => {
    expect(nextBrowserZoomFactor(1)).toBe(1.1);
    expect(previousBrowserZoomFactor(1)).toBe(0.9);
    expect(nextBrowserZoomFactor(BROWSER_DEFAULT_ZOOM_FACTOR)).toBe(1.1);
    expect(previousBrowserZoomFactor(BROWSER_DEFAULT_ZOOM_FACTOR)).toBe(0.9);
  });

  it('snaps off-preset factors to the nearest preset in the step direction', () => {
    expect(nextBrowserZoomFactor(1.05)).toBe(1.1);
    expect(previousBrowserZoomFactor(1.05)).toBe(1);
  });

  it('saturates at the range boundaries', () => {
    expect(nextBrowserZoomFactor(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(previousBrowserZoomFactor(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
    expect(canZoomOut(1)).toBe(true);
  });

  it('detects the default factor', () => {
    expect(isDefaultBrowserZoomFactor(1)).toBe(true);
    expect(isDefaultBrowserZoomFactor(1.25)).toBe(false);
  });

  it('formats factors as rounded percentages', () => {
    expect(formatBrowserZoomPercent(0.33)).toBe('33%');
    expect(formatBrowserZoomPercent(2.5)).toBe('250%');
  });
});
