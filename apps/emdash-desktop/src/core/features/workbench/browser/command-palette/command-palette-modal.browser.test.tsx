import '@emdash/ui/style.css';
import { Command } from 'cmdk';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  definePaletteProviderCatalog,
  type PaletteProviderDef,
  type PaletteProviderMatch,
} from '@core/primitives/palette/api';
import { CommandPaletteView } from './command-palette-modal';

function match(id: string, title: string): PaletteProviderMatch {
  return { id, title, relevance: { band: 'exact', score: 1 } };
}

function rowProvider(
  options: Omit<PaletteProviderDef, 'minQueryLength' | 'render'> & {
    minQueryLength?: number;
  }
): PaletteProviderDef {
  return {
    minQueryLength: 1,
    render: ({ match: item, value, onSelect }) => (
      <Command.Item value={value} onSelect={onSelect}>
        {item.title}
      </Command.Item>
    ),
    ...options,
  };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('CommandPaletteView', () => {
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

  it('shows keyword mode and returns to unified provider results when cleared', async () => {
    const commandSearch = vi.fn(() => [match('toggle-theme', 'Toggle Theme')]);
    const fileSearch = vi.fn(() => [match('theme-file', 'theme.ts')]);
    const catalog = definePaletteProviderCatalog([
      rowProvider({
        kind: 'commands',
        keyword: '@commands',
        search: commandSearch,
      }),
      rowProvider({
        kind: 'files',
        keyword: '@files',
        minQueryLength: 2,
        search: fileSearch,
      }),
    ]);
    const onClose = vi.fn();

    await act(async () => {
      root.render(<CommandPaletteView providerCatalog={catalog} context={{}} onClose={onClose} />);
    });
    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '@commands theme');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLButtonElement>('button[aria-label="Clear @commands mode"]')
      ).not.toBeNull();
      expect(host.textContent).toContain('Toggle Theme');
    });
    expect(host.textContent).not.toContain('theme.ts');
    expect(commandSearch).toHaveBeenLastCalledWith({ query: 'theme', context: {} });
    expect(fileSearch).not.toHaveBeenCalled();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Clear @commands mode"]')!.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('theme.ts'));
    expect(fileSearch).toHaveBeenLastCalledWith({ query: 'theme', context: {} });

    await act(async () => {
      [...host.querySelectorAll<HTMLElement>('[cmdk-item]')]
        .find((item) => item.textContent === 'Toggle Theme')!
        .click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
