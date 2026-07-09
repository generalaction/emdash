// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettingsTargetSelector, scrollSettingTargetIntoView } from './settings-scroll-target';

describe('settings scroll target helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('scrolls the matching settings target into view', () => {
    const target = document.createElement('div');
    target.dataset.settingId = 'terminal-font';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);

    expect(scrollSettingTargetIntoView('terminal-font')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('returns false for unknown settings targets', () => {
    expect(scrollSettingTargetIntoView('missing-setting')).toBe(false);
  });

  it('escapes target ids for querySelector', () => {
    const target = document.createElement('div');
    target.dataset.settingId = 'setting.with.dot';
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);

    expect(getSettingsTargetSelector('setting.with.dot')).toContain('setting');
    expect(scrollSettingTargetIntoView('setting.with.dot')).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
