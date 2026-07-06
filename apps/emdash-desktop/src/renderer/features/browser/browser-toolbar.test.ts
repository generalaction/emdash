import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionSnapshot } from '@shared/browser';
import { BrowserToolbar } from './browser-toolbar';

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    browser: {
      openDevTools: vi.fn(),
    },
  },
}));

function session(overrides: Partial<BrowserSessionSnapshot> = {}): BrowserSessionSnapshot {
  return {
    browserId: 'browser-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    profileId: 'default',
    partition: 'persist:emdash-browser-profile',
    currentUrl: 'https://example.com/',
    title: 'Example',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('BrowserToolbar annotation control', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('shows active state and count, and toggles annotation mode', async () => {
    const onToggleAnnotationMode = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(BrowserToolbar, {
          session: session(),
          adapter: null,
          annotationMode: true,
          annotationCount: 12,
          onToggleAnnotationMode,
        })
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Annotation mode"]'
    );
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.textContent).toContain('9+');

    await act(async () => {
      button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleAnnotationMode).toHaveBeenCalledTimes(1);
  });

  it('can disable annotation mode', async () => {
    await act(async () => {
      root.render(
        React.createElement(BrowserToolbar, {
          session: session(),
          adapter: null,
          annotationDisabled: true,
        })
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Annotation mode"]'
    );
    expect(button?.disabled).toBe(true);
  });
});
