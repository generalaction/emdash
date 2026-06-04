import { describe, expect, it } from 'vitest';
import { BrowserNavigationHistoryStore } from './browser-navigation-history-store';

describe('BrowserNavigationHistoryStore', () => {
  it('tracks back and forward targets from committed navigations', () => {
    const store = new BrowserNavigationHistoryStore();

    store.recordNavigation('browser-1', 'https://example.com/');
    store.recordNavigation('browser-1', 'https://example.com/docs');

    expect(store.canGoBack('browser-1')).toBe(true);
    expect(store.goBack('browser-1')).toBe('https://example.com/');
    expect(store.canGoForward('browser-1')).toBe(true);
    expect(store.goForward('browser-1')).toBe('https://example.com/docs');
  });

  it('truncates forward history after a new navigation', () => {
    const store = new BrowserNavigationHistoryStore();

    store.recordNavigation('browser-1', 'https://example.com/');
    store.recordNavigation('browser-1', 'https://example.com/docs');
    expect(store.goBack('browser-1')).toBe('https://example.com/');
    store.recordNavigation('browser-1', 'https://example.com/pricing');

    expect(store.canGoForward('browser-1')).toBe(false);
    expect(store.goBack('browser-1')).toBe('https://example.com/');
  });

  it('recognizes native back and forward navigation events without duplicating entries', () => {
    const store = new BrowserNavigationHistoryStore();

    store.recordNavigation('browser-1', 'https://example.com/');
    store.recordNavigation('browser-1', 'https://example.com/docs');
    store.recordNavigation('browser-1', 'https://example.com/');

    expect(store.canGoBack('browser-1')).toBe(false);
    expect(store.canGoForward('browser-1')).toBe(true);
    expect(store.goForward('browser-1')).toBe('https://example.com/docs');
  });
});
