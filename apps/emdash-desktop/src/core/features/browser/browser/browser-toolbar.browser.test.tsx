import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionSnapshot } from '@core/primitives/browser/api';
import { BrowserToolbar } from './browser-toolbar';

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
}));

vi.mock('@core/features/browser/api/browser/client', () => ({
  getBrowserClient: vi.fn(async () => ({})),
}));

vi.mock('./browser-toolbar-actions', () => ({
  canOpenBrowserUrlExternally: () => false,
  captureBrowserScreenshot: vi.fn(),
  clearBrowserData: vi.fn(),
  confirmClearBrowserStorage: vi.fn(),
  openBrowserUrlExternally: vi.fn(),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const FAVICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Favicon slot: 0.5rem offset + 0.875rem icon = 22px from the input's left edge.
const FAVICON_SLOT_RIGHT_EDGE_PX = 22;
const MIN_GAP_PX = 4;

function session(): BrowserSessionSnapshot {
  return {
    browserId: 'browser-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    profileId: 'default',
    partition: 'persist:emdash-browser-profile',
    currentUrl: 'https://example.com/',
    title: 'Example',
    faviconUrl: FAVICON_DATA_URL,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('BrowserToolbar URL input', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('reserves space for the favicon so the URL text does not overlap it', async () => {
    await act(async () => {
      root.render(<BrowserToolbar session={session()} adapter={null} />);
    });

    const favicon = host.querySelector<HTMLImageElement>(`img[src="${FAVICON_DATA_URL}"]`);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Browser URL"]');
    expect(favicon).not.toBeNull();
    expect(input).not.toBeNull();

    const paddingLeft = parseFloat(getComputedStyle(input!).paddingLeft);
    expect(paddingLeft).toBeGreaterThanOrEqual(FAVICON_SLOT_RIGHT_EDGE_PX + MIN_GAP_PX);
  });
});
