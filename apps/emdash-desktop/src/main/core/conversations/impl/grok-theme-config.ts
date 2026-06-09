import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { nativeTheme } from 'electron';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import type { Theme } from '@shared/core/app-settings';

type EffectiveTheme = 'emlight' | 'emdark';
type GrokTheme = 'grokday' | 'groknight';

const UI_HEADER_PATTERN = /^\s*\[ui\]\s*(?:#.*)?$/;
const TABLE_HEADER_PATTERN = /^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?$/;
const THEME_ASSIGNMENT_PATTERN = /^(\s*theme\s*=\s*)(?:["'][^"']*["']|[^#\r\n]*)(\s*(?:#.*)?)$/;

export function resolveEffectiveTheme(theme: Theme, shouldUseDarkColors: boolean): EffectiveTheme {
  if (theme === 'emlight' || theme === 'emdark') return theme;
  return shouldUseDarkColors ? 'emdark' : 'emlight';
}

export function resolveGrokTheme(effectiveTheme: EffectiveTheme): GrokTheme {
  return effectiveTheme === 'emlight' ? 'grokday' : 'groknight';
}

export function getGrokConfigPath(env: Record<string, string | undefined> = process.env): string {
  const grokHome = env.GROK_HOME?.trim() || path.join(homedir(), '.grok');
  return path.join(grokHome, 'config.toml');
}

function splitLinesWithEndings(raw: string): string[] {
  return raw.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

function lineContent(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, '');
}

function lineEnding(line: string, fallback: string): string {
  return line.match(/(?:\r\n|\n|\r)$/)?.[0] ?? fallback;
}

export function setGrokThemeInConfig(raw: string, theme: GrokTheme): string {
  // Patch text directly so user comments and hand formatting survive theme sync.
  const lines = splitLinesWithEndings(raw);
  const defaultEnding = raw.includes('\r\n') ? '\r\n' : '\n';
  const themeLine = `theme = "${theme}"`;
  const uiHeaderIndex = lines.findIndex((line) => UI_HEADER_PATTERN.test(lineContent(line)));

  if (uiHeaderIndex === -1) {
    const separator =
      raw.length > 0 && !raw.endsWith('\n') && !raw.endsWith('\r') ? defaultEnding : '';
    const prefix = raw.length > 0 && separator === '' ? defaultEnding : '';
    return `${raw}${separator}${prefix}[ui]${defaultEnding}${themeLine}${defaultEnding}`;
  }

  let sectionEnd = lines.length;
  for (let i = uiHeaderIndex + 1; i < lines.length; i++) {
    if (TABLE_HEADER_PATTERN.test(lineContent(lines[i]))) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = uiHeaderIndex + 1; i < sectionEnd; i++) {
    const content = lineContent(lines[i]);
    const match = content.match(THEME_ASSIGNMENT_PATTERN);
    if (!match) continue;

    const nextLine = `${match[1]}"${theme}"${match[2]}${lineEnding(lines[i], defaultEnding)}`;
    if (nextLine === lines[i]) return raw;
    lines[i] = nextLine;
    return lines.join('');
  }

  const headerEnding = lineEnding(lines[uiHeaderIndex], defaultEnding);
  lines.splice(uiHeaderIndex + 1, 0, `${themeLine}${headerEnding}`);
  return lines.join('');
}

export async function syncGrokThemeWithAppTheme(
  options: {
    env?: Record<string, string | undefined>;
    configPath?: string;
  } = {}
): Promise<void> {
  const appTheme = await appSettingsService.get('theme');
  const effectiveTheme = resolveEffectiveTheme(appTheme, nativeTheme.shouldUseDarkColors);
  const grokTheme = resolveGrokTheme(effectiveTheme);
  const configPath =
    options.configPath ?? getGrokConfigPath({ ...process.env, ...(options.env ?? {}) });

  try {
    let existing = '';
    try {
      existing = await readFile(configPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const next = setGrokThemeInConfig(existing, grokTheme);
    if (next === existing) return;

    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, next);
  } catch (error) {
    log.warn('GrokThemeConfig: failed to sync Grok theme with Emdash theme', {
      configPath,
      grokTheme,
      error: String(error),
    });
  }
}
