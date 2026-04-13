import { describe, expect, it } from 'vitest';
import { getSettingsToggleDestination } from '@renderer/lib/layout/settings-shortcut';

describe('getSettingsToggleDestination', () => {
  it('opens settings from any non-settings view', () => {
    expect(getSettingsToggleDestination('home', null)).toBe('settings');
    expect(getSettingsToggleDestination('task', 'task')).toBe('settings');
    expect(getSettingsToggleDestination('project', 'project')).toBe('settings');
  });

  it('returns to the last non-settings view when settings is already open', () => {
    expect(getSettingsToggleDestination('settings', 'task')).toBe('task');
    expect(getSettingsToggleDestination('settings', 'mcp')).toBe('mcp');
  });

  it('falls back to home when settings is open without a remembered source view', () => {
    expect(getSettingsToggleDestination('settings', null)).toBe('home');
  });
});
