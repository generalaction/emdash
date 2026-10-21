import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTheme = vi.fn();

vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
}));

vi.mock('@main/bootstrap/core/service-instances', () => ({
  getAppSettingsService: () => ({ get: getTheme }),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

import { getTerminalDisplayEnv } from './display-env';

describe('getTerminalDisplayEnv', () => {
  beforeEach(() => {
    getTheme.mockReset();
    vi.stubEnv('FORCE_HYPERLINK', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forces OSC 8 hyperlinks alongside COLORFGBG', async () => {
    getTheme.mockResolvedValue('emdark');
    expect(await getTerminalDisplayEnv()).toEqual({ COLORFGBG: '15;0', FORCE_HYPERLINK: '1' });
  });

  it('keeps a user-provided FORCE_HYPERLINK value', async () => {
    vi.stubEnv('FORCE_HYPERLINK', '0');
    getTheme.mockResolvedValue('emlight');
    expect(await getTerminalDisplayEnv()).toEqual({ COLORFGBG: '0;15', FORCE_HYPERLINK: '0' });
  });

  it('still forces hyperlinks when the theme cannot be resolved', async () => {
    getTheme.mockRejectedValue(new Error('db error'));
    expect(await getTerminalDisplayEnv()).toEqual({ FORCE_HYPERLINK: '1' });
  });
});
