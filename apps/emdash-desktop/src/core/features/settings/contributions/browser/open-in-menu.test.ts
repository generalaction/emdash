import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenInMenu } from '@core/features/settings/contributions/browser/open-in-menu';
import { OPEN_IN_APPS } from '@core/primitives/open-in-apps/api/open-in-apps';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openIn: vi.fn(),
  openInApps: {
    availability: {
      finder: true,
      cursor: true,
      terminal: true,
    },
    loading: false,
  },
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  updateOpenIn: vi.fn(),
}));

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: (key: string) => {
    if (key === 'openIn') {
      return {
        value: { default: 'finder', hidden: [] },
        update: mocks.updateOpenIn,
        isLoading: false,
      };
    }
    return { value: {}, update: vi.fn(), isLoading: false };
  },
}));

vi.mock('@core/features/settings/api/browser/useOpenInApps', () => ({
  useOpenInApps: () => ({
    icons: {},
    labels: {
      finder: 'Explorer',
      cursor: 'Cursor',
      terminal: 'Terminal',
    },
    availability: mocks.openInApps.availability,
    installedApps: [OPEN_IN_APPS.finder, OPEN_IN_APPS.cursor, OPEN_IN_APPS.terminal],
    platform: 'win32',
    loading: mocks.openInApps.loading,
  }),
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({ openIn: mocks.openIn }),
}));

vi.mock('@core/primitives/keybindings/browser/shortcut', async () => {
  const React = await import('react');
  return {
    BoundShortcut: () => React.createElement('span', {}),
  };
});

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();

  type DropdownMenuContextValue = {
    onValueChange?: (value: string) => void;
  };

  const DropdownMenuContext = React.createContext<DropdownMenuContextValue>({});

  function MockDropdownMenuRadioItem({
    children,
    disabled,
    value,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    value: string;
  }) {
    const { onValueChange } = React.useContext(DropdownMenuContext);
    return React.createElement(
      'button',
      {
        disabled,
        'data-testid': `open-in-option-${value}`,
        onClick: () => onValueChange?.(value),
      },
      children
    );
  }

  return {
    ...actual,
    useToast: () => ({ toast: mocks.toast }),
    DropdownMenu: {
      Root: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      RadioGroup: ({
        children,
        onValueChange,
      }: {
        children: React.ReactNode;
        onValueChange?: (value: string) => void;
      }) =>
        React.createElement(
          DropdownMenuContext.Provider,
          { value: { onValueChange } },
          React.createElement('div', {}, children)
        ),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      RadioItem: MockDropdownMenuRadioItem,
      Trigger: ({ children }: { children: React.ReactNode }) =>
        React.createElement('button', {}, children),
    },
    Tooltip: {
      Root: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Content: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Provider: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', {}, children),
      Trigger: ({
        children,
        render,
      }: {
        children?: React.ReactNode;
        render?: React.ReactElement;
      }) => render ?? React.createElement('div', {}, children),
    },
  };
});

describe('OpenInMenu', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.openIn.mockResolvedValue({ success: true });
    mocks.openInApps.availability = {
      finder: true,
      cursor: true,
      terminal: true,
    };
    mocks.openInApps.loading = false;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('launches the selected dropdown app immediately while saving it as preferred', async () => {
    await act(async () => {
      root.render(React.createElement(OpenInMenu, { path: 'C:/repo' }));
    });

    const cursorOption = container.querySelector('[data-testid="open-in-option-cursor"]');
    expect(cursorOption).not.toBeNull();

    await act(async () => {
      cursorOption!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.updateOpenIn).toHaveBeenCalledWith({ default: 'cursor' });
    expect(mocks.updateOpenIn).toHaveBeenCalledTimes(1);
    expect(mocks.openIn).toHaveBeenCalledWith({
      app: 'cursor',
      isRemote: false,
      path: 'C:/repo',
      sshConnectionId: undefined,
    });
    expect(mocks.openIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the preferred app persisted when a dropdown launch fails', async () => {
    mocks.openIn.mockResolvedValueOnce({ success: false, error: 'Cursor is unavailable' });

    await act(async () => {
      root.render(React.createElement(OpenInMenu, { path: 'C:/repo' }));
    });

    const cursorOption = container.querySelector('[data-testid="open-in-option-cursor"]');
    expect(cursorOption).not.toBeNull();

    await act(async () => {
      cursorOption!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.updateOpenIn).toHaveBeenCalledWith({ default: 'cursor' });
    expect(mocks.toast.error).toHaveBeenCalledWith('Open in Cursor failed', {
      description: 'Cursor is unavailable',
    });
  });

  it('disables unavailable dropdown apps after availability loads', async () => {
    mocks.openInApps.availability = {
      finder: true,
      cursor: false,
      terminal: true,
    };

    await act(async () => {
      root.render(React.createElement(OpenInMenu, { path: 'C:/repo' }));
    });

    const cursorOption = container.querySelector('[data-testid="open-in-option-cursor"]');
    expect(cursorOption).not.toBeNull();
    expect(cursorOption).toHaveProperty('disabled', true);
  });
});
