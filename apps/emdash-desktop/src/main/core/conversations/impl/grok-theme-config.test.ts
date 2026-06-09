import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as toml from 'smol-toml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getGrokConfigPath,
  resolveEffectiveTheme,
  resolveGrokTheme,
  setGrokThemeInConfig,
  syncGrokThemeWithAppTheme,
} from './grok-theme-config';

const mockState = vi.hoisted(() => ({
  theme: 'emlight' as 'emlight' | 'emdark' | null,
  shouldUseDarkColors: false,
}));

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return mockState.shouldUseDarkColors;
    },
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockImplementation(() => Promise.resolve(mockState.theme)),
  },
}));

const tempDirs: string[] = [];

afterEach(async () => {
  mockState.theme = 'emlight';
  mockState.shouldUseDarkColors = false;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempConfigDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'emdash-grok-theme-'));
  tempDirs.push(dir);
  return dir;
}

describe('grok theme config', () => {
  it('maps the effective Emdash theme to the matching Grok theme', () => {
    expect(resolveGrokTheme('emlight')).toBe('grokday');
    expect(resolveGrokTheme('emdark')).toBe('groknight');
  });

  it('resolves system theme only when Emdash theme is unset', () => {
    expect(resolveEffectiveTheme('emlight', true)).toBe('emlight');
    expect(resolveEffectiveTheme('emdark', false)).toBe('emdark');
    expect(resolveEffectiveTheme(null, true)).toBe('emdark');
    expect(resolveEffectiveTheme(null, false)).toBe('emlight');
  });

  it('uses GROK_HOME when resolving the config path', () => {
    expect(getGrokConfigPath({ GROK_HOME: '/tmp/custom-grok-home' })).toBe(
      '/tmp/custom-grok-home/config.toml'
    );
  });

  it('updates only the Grok UI theme line without reformatting comments', () => {
    const next = setGrokThemeInConfig(
      [
        '# user config',
        'telemetry = false',
        '',
        '[ui] # display settings',
        'max_thoughts_width = 120 # keep this comment',
        'theme = "groknight" # app managed',
        '',
        '[models]',
        'default = "grok-build"',
        '',
      ].join('\n'),
      'grokday'
    );

    expect(next).toBe(
      [
        '# user config',
        'telemetry = false',
        '',
        '[ui] # display settings',
        'max_thoughts_width = 120 # keep this comment',
        'theme = "grokday" # app managed',
        '',
        '[models]',
        'default = "grok-build"',
        '',
      ].join('\n')
    );

    const parsed = toml.parse(next) as Record<string, unknown>;
    expect(parsed.telemetry).toBe(false);
    expect(parsed.ui).toEqual({
      max_thoughts_width: 120,
      theme: 'grokday',
    });
  });

  it('inserts a theme line into an existing UI section without touching following sections', () => {
    expect(
      setGrokThemeInConfig('[ui]\ncompact_mode = true\n\n[agent]\nname = "default"\n', 'grokday')
    ).toBe('[ui]\ntheme = "grokday"\ncompact_mode = true\n\n[agent]\nname = "default"\n');
  });

  it('treats TOML array table headers as section boundaries', () => {
    expect(
      setGrokThemeInConfig('[ui]\ncompact_mode = true\n\n[[agent]]\ntheme = "red"\n', 'grokday')
    ).toBe('[ui]\ntheme = "grokday"\ncompact_mode = true\n\n[[agent]]\ntheme = "red"\n');
  });

  it('writes grokday before launching Grok in Emdash light mode', async () => {
    const dir = await makeTempConfigDir();
    const configPath = path.join(dir, 'config.toml');
    await writeFile(configPath, '[ui]\nmax_thoughts_width = 120\n');

    await syncGrokThemeWithAppTheme({ configPath });

    const parsed = toml.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.ui).toEqual({
      max_thoughts_width: 120,
      theme: 'grokday',
    });
  });

  it('writes groknight when Emdash follows a dark system theme', async () => {
    mockState.theme = null;
    mockState.shouldUseDarkColors = true;
    const dir = await makeTempConfigDir();
    const configPath = path.join(dir, 'config.toml');

    await syncGrokThemeWithAppTheme({ configPath });

    const parsed = toml.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.ui).toEqual({ theme: 'groknight' });
  });
});
