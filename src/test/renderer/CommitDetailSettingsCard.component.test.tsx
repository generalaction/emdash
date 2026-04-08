import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import CommitDetailSettingsCard from '../../renderer/components/CommitDetailSettingsCard';

vi.mock('@/contexts/AppSettingsProvider', () => ({
  useAppSettings: vi.fn(),
}));

function setup(expandCommitDetail = false) {
  const updateSettings = vi.fn();
  vi.mocked(useAppSettings).mockReturnValue({
    settings: {
      interface: { expandCommitDetail },
    } as unknown as ReturnType<typeof useAppSettings>['settings'],
    isLoading: false,
    isSaving: false,
    updateSettings,
  });
  render(<CommitDetailSettingsCard />);
  return { updateSettings };
}

describe('CommitDetailSettingsCard', () => {
  it('renders the toggle label', () => {
    setup();
    expect(screen.getByText('Expand commit details by default')).toBeInTheDocument();
  });

  it('is unchecked when expandCommitDetail is false', () => {
    setup(false);
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');
  });

  it('is checked when expandCommitDetail is true', () => {
    setup(true);
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
  });

  it('calls updateSettings with true when toggled on', () => {
    const { updateSettings } = setup(false);
    fireEvent.click(screen.getByRole('switch'));
    expect(updateSettings).toHaveBeenCalledWith({ interface: { expandCommitDetail: true } });
  });

  it('calls updateSettings with false when toggled off', () => {
    const { updateSettings } = setup(true);
    fireEvent.click(screen.getByRole('switch'));
    expect(updateSettings).toHaveBeenCalledWith({ interface: { expandCommitDetail: false } });
  });
});
