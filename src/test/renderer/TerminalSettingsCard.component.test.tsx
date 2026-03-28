import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useAppContext } from '@/contexts/AppContextProvider';
import TerminalSettingsCard from '../../renderer/components/TerminalSettingsCard';
import type { AppSettings } from '../../main/settings';

vi.mock('@/contexts/AppSettingsProvider', () => ({
  useAppSettings: vi.fn(),
}));

vi.mock('@/contexts/AppContextProvider', () => ({
  useAppContext: vi.fn(),
}));

function setup({
  platform = 'darwin',
  terminal = {},
}: {
  platform?: string;
  terminal?: Partial<AppSettings['terminal']>;
} = {}) {
  const updateSettings = vi.fn();
  vi.mocked(useAppContext).mockReturnValue({ platform });
  vi.mocked(useAppSettings).mockReturnValue({
    settings: {
      terminal: {
        fontFamily: '',
        fontSize: 0,
        autoCopyOnSelection: false,
        macOptionIsMeta: false,
        ...terminal,
      },
    } as unknown as ReturnType<typeof useAppSettings>['settings'],
    isLoading: false,
    isSaving: false,
    updateSettings,
  });
  render(<TerminalSettingsCard />);
  return { updateSettings };
}

describe('TerminalSettingsCard', () => {
  describe('macOptionIsMeta toggle', () => {
    it('renders on darwin', () => {
      setup({ platform: 'darwin' });
      expect(screen.getByText('Use Option as Meta key')).toBeInTheDocument();
    });

    it('does not render on non-darwin platforms', () => {
      setup({ platform: 'win32' });
      expect(screen.queryByText('Use Option as Meta key')).not.toBeInTheDocument();
    });

    it('is checked when macOptionIsMeta is true', () => {
      setup({ terminal: { macOptionIsMeta: true } });
      expect(screen.getByRole('switch', { name: 'Use Option as Meta key' })).toHaveAttribute(
        'data-state',
        'checked'
      );
    });

    it('calls updateSettings when toggled', () => {
      const { updateSettings } = setup({ terminal: { macOptionIsMeta: false } });
      fireEvent.click(screen.getByRole('switch', { name: 'Use Option as Meta key' }));
      expect(updateSettings).toHaveBeenCalledWith({ terminal: { macOptionIsMeta: true } });
    });
  });

  describe('autoCopyOnSelection toggle', () => {
    it('renders on all platforms', () => {
      setup({ platform: 'linux' });
      expect(screen.getByText('Auto-copy selected text')).toBeInTheDocument();
    });

    it('calls updateSettings when toggled', () => {
      const { updateSettings } = setup({ terminal: { autoCopyOnSelection: false } });
      fireEvent.click(screen.getByRole('switch', { name: 'Auto-copy selected text' }));
      expect(updateSettings).toHaveBeenCalledWith({ terminal: { autoCopyOnSelection: true } });
    });
  });
});
