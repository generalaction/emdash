import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { ProviderId } from '@shared/providers/registry';
import { isValidProviderId } from '@shared/providers/registry';
import type { AppSettings } from '../../types/settings';

// Re-export AppSettings for convenience
export type { AppSettings } from '../../types/settings';

const DEFAULT_PROVIDER_ID: ProviderId = 'claude';
const DEFAULT_KANBAN_ENABLED = true;

const DEFAULT_SETTINGS: AppSettings = {
  repository: {
    branchTemplate: 'agent/{slug}-{timestamp}',
    pushOnCreate: true,
  },
  projectPrep: {
    autoInstallOnOpenInEditor: true,
  },
  browserPreview: {
    enabled: true,
    engine: 'chromium',
  },
  notifications: {
    enabled: true,
    sound: true,
  },
  mcp: {
    context7: {
      enabled: false,
      installHintsDismissed: {},
    },
  },
  defaultProvider: DEFAULT_PROVIDER_ID,
  tasks: {
    autoGenerateName: true,
    autoApproveByDefault: false,
  },
  projects: {
    defaultDirectory: join(homedir(), 'emdash-projects'),
  },
  features: {
    kanban: {
      enabled: DEFAULT_KANBAN_ENABLED,
    },
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
      cached = normalizeSettings(deepMerge(DEFAULT_SETTINGS, parsed));
      return cached;
    }
  } catch {
    // ignore read/parse errors, fall through to defaults
  }
  cached = { ...DEFAULT_SETTINGS };
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
  } catch {}
}

/**
 * Coerce and validate settings for robustness and forward-compatibility.
 */
function normalizeSettings(input: AppSettings): AppSettings {
  const out: AppSettings = {
    repository: {
      branchTemplate: DEFAULT_SETTINGS.repository.branchTemplate,
      pushOnCreate: DEFAULT_SETTINGS.repository.pushOnCreate,
    },
    projectPrep: {
      autoInstallOnOpenInEditor: DEFAULT_SETTINGS.projectPrep.autoInstallOnOpenInEditor,
    },
    browserPreview: {
      enabled: DEFAULT_SETTINGS.browserPreview!.enabled,
      engine: DEFAULT_SETTINGS.browserPreview!.engine,
    },
    notifications: {
      enabled: DEFAULT_SETTINGS.notifications!.enabled,
      sound: DEFAULT_SETTINGS.notifications!.sound,
    },
    mcp: {
      context7: {
        enabled: DEFAULT_SETTINGS.mcp!.context7!.enabled,
        installHintsDismissed: {},
      },
    },
    features: {
      kanban: {
        enabled: DEFAULT_KANBAN_ENABLED,
      },
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

  out.repository.branchTemplate = template;
  out.repository.pushOnCreate = push;

  // Project prep
  const prep = input.projectPrep;
  out.projectPrep.autoInstallOnOpenInEditor = Boolean(
    prep?.autoInstallOnOpenInEditor ?? DEFAULT_SETTINGS.projectPrep.autoInstallOnOpenInEditor
  );

  const bp = input.browserPreview;
  out.browserPreview = {
    enabled: Boolean(bp?.enabled ?? DEFAULT_SETTINGS.browserPreview!.enabled),
    engine: 'chromium',
  };

  const notif = input.notifications;
  out.notifications = {
    enabled: Boolean(notif?.enabled ?? DEFAULT_SETTINGS.notifications!.enabled),
    sound: Boolean(notif?.sound ?? DEFAULT_SETTINGS.notifications!.sound),
  };

  // MCP
  const mcp = input.mcp;
  const c7 = mcp?.context7;
  out.mcp = {
    context7: {
      enabled: Boolean(c7?.enabled ?? DEFAULT_SETTINGS.mcp!.context7!.enabled),
      installHintsDismissed:
        c7?.installHintsDismissed && typeof c7.installHintsDismissed === 'object'
          ? { ...c7.installHintsDismissed }
          : {},
    },
  };

  // Default provider
  const defaultProvider = input.defaultProvider;
  out.defaultProvider = isValidProviderId(defaultProvider)
    ? defaultProvider
    : DEFAULT_SETTINGS.defaultProvider!;

  // Tasks
  const tasks = input.tasks;
  out.tasks = {
    autoGenerateName: Boolean(tasks?.autoGenerateName ?? DEFAULT_SETTINGS.tasks!.autoGenerateName),
    autoApproveByDefault: Boolean(
      tasks?.autoApproveByDefault ?? DEFAULT_SETTINGS.tasks!.autoApproveByDefault
    ),
  };

  // Projects
  const projects = input.projects;
  let defaultDir = String(
    projects?.defaultDirectory ?? DEFAULT_SETTINGS.projects!.defaultDirectory
  ).trim();
  if (!defaultDir) {
    defaultDir = DEFAULT_SETTINGS.projects!.defaultDirectory;
  }
  // Resolve ~ to home directory if present
  if (defaultDir.startsWith('~')) {
    defaultDir = join(homedir(), defaultDir.slice(1));
  }
  out.projects = {
    defaultDirectory: defaultDir,
  };

  // Features
  const features = input.features;
  const kanban = features?.kanban;
  out.features = {
    kanban: {
      enabled: Boolean(kanban?.enabled ?? DEFAULT_KANBAN_ENABLED),
    },
  };

  return out;
}
