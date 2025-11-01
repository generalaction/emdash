import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface RepositorySettings {
  branchTemplate: string; // e.g., 'agent/{slug}-{timestamp}'
  pushOnCreate: boolean; // default true
  // Root directory where GitHub repositories will be cloned
  cloneRoot: string;
}

export interface AppSettings {
  repository: RepositorySettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  repository: {
    branchTemplate: 'agent/{slug}-{timestamp}',
    pushOnCreate: true,
    // Default to Documents/Emdash under the current user
    cloneRoot: '',
  },
};

function getSettingsPath(): string {
  const dir = app.getPath('userData');
  return join(dir, 'settings.json');
}

function deepMerge<T extends Record<string, any>>(base: T, partial?: Partial<T>): T {
  if (!partial) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(partial)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge((base as any)[k] ?? {}, v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

let cached: AppSettings | null = null;

/**
 * Load application settings from disk with sane defaults.
 */
export function getAppSettings(): AppSettings {
  try {
    if (cached) return cached;
    const file = getSettingsPath();
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      // Compute defaults that depend on app paths lazily
      const withDynamicDefaults = ensureDynamicDefaults(DEFAULT_SETTINGS);
      cached = normalizeSettings(deepMerge(withDynamicDefaults, parsed));
      return cached;
    }
  } catch {
    // ignore read/parse errors, fall through to defaults
  }
  cached = ensureDynamicDefaults({ ...DEFAULT_SETTINGS });
  return cached;
}

/**
 * Update settings and persist to disk. Partial updates are deeply merged.
 */
export function updateAppSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getAppSettings();
  const merged = deepMerge(current, partial);
  const next = normalizeSettings(merged);
  persistSettings(next);
  cached = next;
  return next;
}

export function persistSettings(settings: AppSettings) {
  try {
    const file = getSettingsPath();
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Ignore write errors; settings are best-effort
  }
}

/**
 * Coerce and validate settings for robustness and forward-compatibility.
 */
function normalizeSettings(input: AppSettings): AppSettings {
  const out: AppSettings = {
    repository: {
      branchTemplate: DEFAULT_SETTINGS.repository.branchTemplate,
      pushOnCreate: DEFAULT_SETTINGS.repository.pushOnCreate,
      cloneRoot: DEFAULT_SETTINGS.repository.cloneRoot,
    },
  };

  // Repository
  const repo = input?.repository ?? DEFAULT_SETTINGS.repository;
  let template = String(repo?.branchTemplate ?? DEFAULT_SETTINGS.repository.branchTemplate);
  template = template.trim();
  if (!template) template = DEFAULT_SETTINGS.repository.branchTemplate;
  // Keep templates reasonably short to avoid overly long refs
  if (template.length > 200) template = template.slice(0, 200);
  const push = Boolean(repo?.pushOnCreate ?? DEFAULT_SETTINGS.repository.pushOnCreate);
  // Clone root: string and non-empty; fall back to dynamic default
  let cloneRoot = String(repo?.cloneRoot ?? '').trim();
  if (!cloneRoot) {
    const docs = app.getPath('documents');
    cloneRoot = joinPathSafe(docs, 'Emdash');
  }

  out.repository.branchTemplate = template;
  out.repository.pushOnCreate = push;
  out.repository.cloneRoot = cloneRoot;
  return out;
}

function joinPathSafe(base: string, leaf: string) {
  try {
    const { join } = require('path') as typeof import('path');
    return join(base, leaf);
  } catch {
    return `${base.replace(/[\\/]+$/, '')}/${leaf.replace(/^[\\/]+/, '')}`;
  }
}

function ensureDynamicDefaults(settings: AppSettings): AppSettings {
  const clone = JSON.parse(JSON.stringify(settings)) as AppSettings;
  try {
    if (!clone.repository.cloneRoot) {
      const docs = app.getPath('documents');
      clone.repository.cloneRoot = joinPathSafe(docs, 'Emdash');
    }
  } catch {
    // Fallback to a relative folder if app path is unavailable
    if (!clone.repository.cloneRoot) clone.repository.cloneRoot = 'Documents/Emdash';
  }
  return clone;
}
