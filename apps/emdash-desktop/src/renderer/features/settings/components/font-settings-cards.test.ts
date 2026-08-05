import { QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@renderer/lib/query-client';
import {
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
} from '@shared/core/editor/editor-settings';
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
} from '@shared/core/terminals/terminal-settings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type SettingsValue = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  values: {} as Record<string, SettingsValue>,
  getWithMeta: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
  resetField: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      getWithMeta: mocks.getWithMeta,
      update: mocks.update,
      reset: mocks.reset,
      resetField: mocks.resetField,
    },
  },
}));

vi.mock('@tanstack/react-hotkeys', () => ({ detectPlatform: () => 'linux' }));

vi.mock('@renderer/lib/hooks/use-terminal-shell-availability', () => ({
  DEFAULT_TERMINAL_SHELL_AVAILABILITY: [],
  useTerminalShellAvailability: () => ({
    data: [
      {
        id: 'system',
        label: 'System default',
        isSystemDefault: true,
        available: true,
      },
    ],
  }),
}));

vi.mock('@renderer/lib/components/terminal-shell-option-label', async () => {
  const { createElement } = await import('react');
  return {
    TerminalShellOptionLabel: ({ entry }: { entry: { label: string } }) =>
      createElement('span', null, entry.label),
  };
});

vi.mock('@renderer/lib/ui/select', async () => {
  const { createElement } = await import('react');
  const Wrapper = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Select: Wrapper,
    SelectContent: Wrapper,
    SelectItem: Wrapper,
    SelectTrigger: Wrapper,
    SelectValue: Wrapper,
  };
});

vi.mock('@renderer/lib/ui/switch', async () => {
  const { createElement } = await import('react');
  return {
    Switch: ({ checked }: { checked?: boolean }) =>
      createElement('button', { type: 'button', 'aria-pressed': checked }),
  };
});

vi.mock('./FontSettingsRows', async () => {
  const { createElement } = await import('react');

  interface FamilyProps {
    title: string;
    value: string;
    defaultLabel: string;
    defaultPreviewFontFamily?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }

  interface SizeProps {
    title: string;
    value: number;
    max: number;
    disabled?: boolean;
    onChange: (value: number) => void;
  }

  const slug = (title: string) => title.toLowerCase().replaceAll(' ', '-');

  return {
    FontFamilySettingRow: (props: FamilyProps) =>
      createElement(
        'div',
        {
          'data-testid': `${slug(props.title)}-family-row`,
          'data-value': props.value,
          'data-default-label': props.defaultLabel,
          'data-default-preview': props.defaultPreviewFontFamily,
        },
        createElement(
          'button',
          {
            type: 'button',
            disabled: props.disabled,
            'aria-label': `Choose custom ${props.title}`,
            onClick: () => props.onChange('  Fira Code  '),
          },
          'Custom'
        ),
        createElement(
          'button',
          {
            type: 'button',
            disabled: props.disabled,
            'aria-label': `Choose default ${props.title}`,
            onClick: () => props.onChange(''),
          },
          'Default'
        )
      ),
    FontSizeSettingRow: (props: SizeProps) =>
      createElement(
        'div',
        {
          'data-testid': `${slug(props.title)}-size-row`,
          'data-value': String(props.value),
        },
        createElement(
          'button',
          {
            type: 'button',
            disabled: props.disabled,
            'aria-label': `Increase ${props.title}`,
            onClick: () => props.onChange(props.value + 1),
          },
          'Increase'
        ),
        createElement(
          'button',
          {
            type: 'button',
            disabled: props.disabled,
            'aria-label': `Exceed ${props.title} maximum`,
            onClick: () => props.onChange(props.max + 5),
          },
          'Exceed maximum'
        )
      ),
  };
});

const { EditorSettingsCard } = await import('./EditorSettingsCard');
const { default: TerminalSettingsCard } = await import('./TerminalSettingsCard');

async function flushUpdates(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('font settings cards', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.values = {
      editor: { fontSize: EDITOR_FONT_SIZE_DEFAULT },
      terminal: {
        fontFamily: 'JetBrains Mono',
        fontSize: TERMINAL_FONT_SIZE_DEFAULT,
        autoCopyOnSelection: false,
        macOptionIsMeta: false,
        defaultShell: 'system',
      },
    };
    mocks.getWithMeta.mockImplementation(async (key: string) => ({
      value: mocks.values[key],
      defaults: mocks.values[key],
      overrides: {},
    }));
    mocks.update.mockImplementation(async (key: string, value: SettingsValue) => {
      mocks.values[key] = value;
    });
    mocks.reset.mockResolvedValue(undefined);
    mocks.resetField.mockResolvedValue(undefined);

    queryClient.clear();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(async () => {
    await queryClient.cancelQueries();
    await act(async () => {
      root.unmount();
      await flushUpdates();
    });
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function render(component: ReactNode): Promise<void> {
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: queryClient }, component));
    });
    await act(async () => {
      await flushUpdates();
    });
  }

  async function click(ariaLabel: string): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${ariaLabel}"]`);
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await flushUpdates();
    });
  }

  it('sends normalized editor preference payloads through the persistence hook', async () => {
    await render(React.createElement(EditorSettingsCard));

    const familyRow = container.querySelector<HTMLElement>(
      '[data-testid="file-preview-font-family-row"]'
    );
    expect(familyRow?.dataset.defaultLabel).toBe('Default (Monaco editor)');
    expect(familyRow?.dataset.defaultPreview).toBe('monospace');

    await click('Choose custom File preview font');
    expect(mocks.update).toHaveBeenLastCalledWith('editor', {
      fontFamily: 'Fira Code',
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
    });
    expect(familyRow?.dataset.value).toBe('Fira Code');

    await click('Choose default File preview font');
    expect(mocks.update).toHaveBeenLastCalledWith('editor', {
      fontFamily: undefined,
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
    });
    expect(familyRow?.dataset.value).toBe('');

    await click('Exceed File preview font size maximum');
    expect(mocks.update).toHaveBeenLastCalledWith('editor', {
      fontFamily: undefined,
      fontSize: EDITOR_FONT_SIZE_MAX,
    });
  });

  it('preserves terminal font selection and size callback behavior after the shared-row refactor', async () => {
    const fontEvents: Array<{ fontFamily?: string; fontSize?: number }> = [];
    window.addEventListener('terminal-font-changed', (event) => {
      fontEvents.push((event as CustomEvent<{ fontFamily?: string; fontSize?: number }>).detail);
    });

    await render(React.createElement(TerminalSettingsCard));

    const familyRow = container.querySelector<HTMLElement>(
      '[data-testid="terminal-font-family-row"]'
    );
    expect(familyRow?.dataset.value).toBe('JetBrains Mono');

    await click('Choose custom Terminal font');
    expect(mocks.update).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ fontFamily: 'Fira Code' })
    );
    expect(fontEvents.at(-1)).toEqual({ fontFamily: 'Fira Code' });

    await click('Choose default Terminal font');
    expect(mocks.update).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ fontFamily: '' })
    );
    expect(fontEvents.at(-1)).toEqual({ fontFamily: '' });

    await click('Increase Terminal font size');
    expect(mocks.update).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ fontSize: TERMINAL_FONT_SIZE_DEFAULT + 1 })
    );
    expect(fontEvents.at(-1)).toEqual({ fontSize: TERMINAL_FONT_SIZE_DEFAULT + 1 });

    await click('Exceed Terminal font size maximum');
    expect(mocks.update).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ fontSize: TERMINAL_FONT_SIZE_MAX })
    );
    expect(fontEvents.at(-1)).toEqual({ fontSize: TERMINAL_FONT_SIZE_MAX });
  });
});
