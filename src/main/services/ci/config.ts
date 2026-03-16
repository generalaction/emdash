import fs from 'node:fs';
import path from 'node:path';
import { isValidProviderId } from '@shared/providers/registry';
import { getAppSettings } from '../../settings';
import type { CiAutoFixConfig, CiAutoFixConfigOverride } from './types';

const DEFAULT_CI_AUTO_FIX_CONFIG: CiAutoFixConfig = {
  enabled: false,
  mode: 'review',
  maxRetries: 2,
  triggerFilters: {
    include: ['*test*', '*lint*'],
    exclude: ['*deploy*', '*build*'],
  },
  maxLogChars: 4_000,
  pollIntervalMs: 120_000,
};

interface EmdashProjectConfig {
  ciAutoFix?: CiAutoFixConfigOverride;
}

function normalizePatternList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeCiAutoFixConfig(
  input: CiAutoFixConfigOverride | undefined,
  fallback: CiAutoFixConfig
): CiAutoFixConfig {
  const normalizedMode =
    input?.mode === 'auto' || input?.mode === 'review' ? input.mode : fallback.mode;

  const normalizeOptionalNumber = (
    value: number | undefined,
    min: number,
    max: number,
    fallbackValue: number
  ): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallbackValue;
    }
    return Math.max(min, Math.min(max, Math.trunc(value)));
  };

  const normalizedMaxRetries = normalizeOptionalNumber(
    input?.maxRetries,
    0,
    20,
    fallback.maxRetries
  );
  const normalizedMaxLogChars = normalizeOptionalNumber(
    input?.maxLogChars,
    500,
    40_000,
    fallback.maxLogChars
  );
  const normalizedPollIntervalMs = normalizeOptionalNumber(
    input?.pollIntervalMs,
    15_000,
    30 * 60_000,
    fallback.pollIntervalMs
  );

  const providerId = isValidProviderId(input?.providerId) ? input?.providerId : fallback.providerId;

  return {
    enabled: input?.enabled ?? fallback.enabled,
    mode: normalizedMode,
    maxRetries: normalizedMaxRetries,
    maxLogChars: normalizedMaxLogChars,
    pollIntervalMs: normalizedPollIntervalMs,
    providerId,
    triggerFilters: {
      include: normalizePatternList(
        input?.triggerFilters?.include,
        fallback.triggerFilters.include
      ),
      exclude: normalizePatternList(
        input?.triggerFilters?.exclude,
        fallback.triggerFilters.exclude
      ),
    },
  };
}

function readProjectOverride(projectPath: string): CiAutoFixConfigOverride | undefined {
  try {
    const configPath = path.join(projectPath, '.emdash.json');
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as EmdashProjectConfig;
    return parsed?.ciAutoFix;
  } catch {
    return undefined;
  }
}

export function getGlobalCiAutoFixConfig(): CiAutoFixConfig {
  const settings = getAppSettings();
  const globalOverride = settings.ciAutoFix;
  return normalizeCiAutoFixConfig(globalOverride, DEFAULT_CI_AUTO_FIX_CONFIG);
}

export function resolveCiAutoFixConfig(projectPath: string): CiAutoFixConfig {
  const globalConfig = getGlobalCiAutoFixConfig();
  const projectOverride = readProjectOverride(projectPath);
  return normalizeCiAutoFixConfig(projectOverride, globalConfig);
}
