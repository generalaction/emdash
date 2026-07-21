import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCleanupOnPrMergeRow } from './TaskSettingsRows';

const mocks = vi.hoisted(() => ({
  onValueChange: undefined as ((value: 'off' | 'archive' | 'delete') => void) | undefined,
  updateAutoCleanupOnPrMerge: vi.fn(),
  useTaskSettings: vi.fn(),
}));

vi.mock('@renderer/features/tasks/hooks/useTaskSettings', () => ({
  useTaskSettings: mocks.useTaskSettings,
}));

vi.mock('@renderer/lib/ui/select', async () => {
  const { createElement } = await import('react');
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: ReactNode;
      onValueChange: (value: 'off' | 'archive' | 'delete') => void;
    }) => {
      mocks.onValueChange = onValueChange;
      return createElement('div', null, children);
    },
    SelectContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) =>
      createElement('div', { 'data-value': value }, children),
    SelectTrigger: ({ children }: { children: ReactNode }) =>
      createElement('button', null, children),
    SelectValue: () => createElement('span', null, 'Off'),
  };
});

describe('AutoCleanupOnPrMergeRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onValueChange = undefined;
    mocks.useTaskSettings.mockReturnValue({
      autoCleanupOnPrMerge: 'off',
      loading: false,
      saving: false,
      isFieldOverridden: () => false,
      resetAutoCleanupOnPrMerge: vi.fn(),
      updateAutoCleanupOnPrMerge: mocks.updateAutoCleanupOnPrMerge,
    });
  });

  it('shows all safe actions and updates the setting', () => {
    const html = renderToStaticMarkup(createElement(AutoCleanupOnPrMergeRow));

    expect(html).toContain('Auto-cleanup when a PR merges');
    expect(html).toContain('Off');
    expect(html).toContain('Archive');
    expect(html).toContain('Delete');

    mocks.onValueChange?.('delete');
    expect(mocks.updateAutoCleanupOnPrMerge).toHaveBeenCalledWith('delete');
  });
});
