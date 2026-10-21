import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { getTerminalDisplayEnv, resolveEffectiveTheme } from './terminal-color-scheme';

describe('resolveEffectiveTheme', () => {
  it('returns emlight when theme is explicitly emlight', () => {
    expect(resolveEffectiveTheme('emlight', true)).toBe('emlight');
    expect(resolveEffectiveTheme('emlight', false)).toBe('emlight');
  });

  it('returns emdark when theme is explicitly emdark', () => {
    expect(resolveEffectiveTheme('emdark', true)).toBe('emdark');
    expect(resolveEffectiveTheme('emdark', false)).toBe('emdark');
  });

  it('follows shouldUseDarkColors when theme is null (system)', () => {
    expect(resolveEffectiveTheme(null, true)).toBe('emdark');
    expect(resolveEffectiveTheme(null, false)).toBe('emlight');
  });
});

describe('getTerminalDisplayEnv', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('FORCE_HYPERLINK', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns COLORFGBG 0;15 for light app theme', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue('emlight');
    const result = await getTerminalDisplayEnv();
    expect(result).toEqual({ COLORFGBG: '0;15', FORCE_HYPERLINK: '1' });
  });

  it('returns COLORFGBG 15;0 for dark app theme', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue('emdark');
    const result = await getTerminalDisplayEnv();
    expect(result).toEqual({ COLORFGBG: '15;0', FORCE_HYPERLINK: '1' });
  });

  it('follows nativeTheme.shouldUseDarkColors when theme is null (system) and dark', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue(null);
    (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = true;
    const result = await getTerminalDisplayEnv();
    expect(result).toEqual({ COLORFGBG: '15;0', FORCE_HYPERLINK: '1' });
  });

  it('follows nativeTheme.shouldUseDarkColors when theme is null (system) and light', async () => {
    vi.mocked(appSettingsService.get).mockResolvedValue(null);
    (nativeTheme as { shouldUseDarkColors: boolean }).shouldUseDarkColors = false;
    const result = await getTerminalDisplayEnv();
    expect(result).toEqual({ COLORFGBG: '0;15', FORCE_HYPERLINK: '1' });
  });

  it('keeps a user-provided FORCE_HYPERLINK value', async () => {
    vi.stubEnv('FORCE_HYPERLINK', '0');
    vi.mocked(appSettingsService.get).mockResolvedValue('emdark');
    const result = await getTerminalDisplayEnv();
    expect(result.FORCE_HYPERLINK).toBe('0');
  });

  it('omits COLORFGBG and logs a warning when settings service throws', async () => {
    vi.mocked(appSettingsService.get).mockRejectedValue(new Error('db error'));
    const { log } = await import('@main/lib/logger');
    const result = await getTerminalDisplayEnv();
    expect(result).toEqual({ FORCE_HYPERLINK: '1' });
    expect(log.warn).toHaveBeenCalledWith(
      'terminal-color-scheme: failed to resolve app theme for COLORFGBG',
      expect.objectContaining({ error: expect.stringContaining('db error') })
    );
  });
});
