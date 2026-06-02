import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_IN_APPS } from '@shared/openInApps';
import { OpenInMenu } from './open-in-menu';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openIn: vi.fn(),
  openInApps: {
    availability: {
      finder: true,
      cursor: true,
    },
    loading: false,
  },
  toast: vi.fn(),
  updateOpenIn: vi.fn(),
}));

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: vi.fn(),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
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

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@renderer/lib/hooks/useKeyboardShortcuts', () => ({
  getEffectiveHotkey: () => null,
  getHotkeyRegistration: () => '',
}));

vi.mock('@renderer/lib/hooks/useOpenInApps', () => ({
  useOpenInApps: () => ({
    icons: {},
    labels: {
      finder: 'Explorer',
      cursor: 'Cursor',
    },
    availability: mocks.openInApps.availability,
    installedApps: [OPEN_IN_APPS.finder, OPEN_IN_APPS.cursor],
    loading: mocks.openInApps.loading,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openIn: mocks.openIn,
    },
  },
}));

vi.mock('@renderer/lib/ui/select', async () => {
  const React = await import('react');

  type SelectContextValue = {
    onValueChange?: (value: string) => void;
  };

  const SelectContext = React.createContext<SelectContextValue>({});

  function MockSelectItem({
    children,
    disabled,
    value,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    value: string;
  }) {
    const { onValueChange } = React.useContext(SelectContext);
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
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) =>
      React.createElement(
        SelectContext.Provider,
        { value: { onValueChange } },
        React.createElement('div', {}, children)
      ),
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    SelectItem: MockSelectItem,
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('button', {}, children),
  };
});

vi.mock('@renderer/lib/ui/shortcut', async () => {
  const React = await import('react');
  return {
    BoundShortcut: () => React.createElement('span', {}),
  };
});

vi.mock('@renderer/lib/ui/tooltip', async () => {
  const React = await import('react');
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipTrigger: ({
      children,
      render,
    }: {
      children?: React.ReactNode;
      render?: React.ReactElement;
    }) => render ?? React.createElement('div', {}, children),
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
    expect(mocks.openIn).toHaveBeenCalledWith({
      app: 'cursor',
      path: 'C:/repo',
    });
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
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Open in Cursor failed',
      description: 'Cursor is unavailable',
      variant: 'destructive',
    });
  });

  it('disables unavailable dropdown apps after availability loads', async () => {
    mocks.openInApps.availability = {
      finder: true,
      cursor: false,
    };

    await act(async () => {
      root.render(React.createElement(OpenInMenu, { path: 'C:/repo' }));
    });

    const cursorOption = container.querySelector('[data-testid="open-in-option-cursor"]');
    expect(cursorOption).not.toBeNull();
    expect(cursorOption).toHaveProperty('disabled', true);
  });
});
