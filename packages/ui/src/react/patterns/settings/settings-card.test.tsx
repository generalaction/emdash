/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsCard } from './settings-card';

afterEach(cleanup);

describe('SettingsCard', () => {
  it('applies className to its rendered card root and preserves caller content', () => {
    render(<SettingsCard className="caller-settings-card">Preferences</SettingsCard>);

    expect(screen.getByText('Preferences')).not.toBeNull();
    expect(
      screen.getByText('Preferences').parentElement?.classList.contains('caller-settings-card')
    ).toBe(true);
  });
});
