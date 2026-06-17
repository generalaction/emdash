import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

import { nativeTheme } from 'electron';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getTerminalColorEnv, resolveEffectiveTheme } from './terminal-color-scheme';

describe('resolveEffectiveTheme', () => {
  it('returns emlight when theme is explicitly emlight', () => {
    expect(resolveEffectiveTheme('emlight', true)).toBe('emlight');
    expect(resolveEffectiveTheme('emlight', false)).toBe('emlight');
  });

  it('returns emdark when theme is explicitly emdark', () => {
    expect(resolveEffectiveTheme('emdark', true)).toBe('emdark');
    expect(resolveEffectiveTheme('emdark', false)).toBe('emdark');
  });

  it('returns emdark when theme is emwebstorm (a dark variant)', () => {
    expect(resolveEffectiveTheme('emwebstorm', true)).toBe('emdark');
    expect(resolveEffectiveTheme('emwebstorm', false)).toBe('emdark');
  });

  it('follows shouldUseDarkColors when theme is null (system)', () => {
    expect(resolveEffectiveTheme(null, true)).toBe('emdark');
    expect(resolveEffectiveTheme(null, false)).toBe('emlight');
  });
});

describe('getTerminalColorEnv', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns COLORFGBG 0;15 for light app theme', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue('emlight');
    const result = await getTerminalColorEnv();
    expect(result).toEqual({ COLORFGBG: '0;15' });
  });

  it('returns COLORFGBG 15;0 for dark app theme', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue('emdark');
    const result = await getTerminalColorEnv();
    expect(result).toEqual({ COLORFGBG: '15;0' });
  });

  it('returns COLORFGBG 15;0 for the WebStorm theme', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue('emwebstorm');
    const result = await getTerminalColorEnv();
    expect(result).toEqual({ COLORFGBG: '15;0' });
  });

  it('follows nativeTheme.shouldUseDarkColors when theme is null (system) and dark', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue(null);
    (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = true;
    const result = await getTerminalColorEnv();
    expect(result).toEqual({ COLORFGBG: '15;0' });
  });

  it('follows nativeTheme.shouldUseDarkColors when theme is null (system) and light', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue(null);
    (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = false;
    const result = await getTerminalColorEnv();
    expect(result).toEqual({ COLORFGBG: '0;15' });
  });

  it('returns {} and logs a warning when settings service throws', async () => {
    vi.mocked(appSettingsService.get).mockRejectedValue(new Error('db error'));
    const { log } = await import('@main/lib/logger');
    const result = await getTerminalColorEnv();
    expect(result).toEqual({});
    expect(log.warn).toHaveBeenCalledWith(
      'terminal-color-scheme: failed to resolve app theme for COLORFGBG',
      expect.objectContaining({ error: expect.stringContaining('db error') })
    );
  });
});
