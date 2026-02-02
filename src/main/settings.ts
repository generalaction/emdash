import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { ProviderId } from '@shared/providers/registry';
import { isValidProviderId } from '@shared/providers/registry';

const DEFAULT_PROVIDER_ID: ProviderId = 'claude';

export interface RepositorySettings {
  branchPrefix: string; // e.g., 'emdash'
  pushOnCreate: boolean;
}

export type ShortcutModifier = 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift';

export interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

export interface KeyboardSettings {
  commandPalette?: ShortcutBinding;
  settings?: ShortcutBinding;
  toggleLeftSidebar?: ShortcutBinding;
  toggleRightSidebar?: ShortcutBinding;
  toggleTheme?: ShortcutBinding;
  toggleKanban?: ShortcutBinding;
  toggleEditor?: ShortcutBinding;
  closeModal?: ShortcutBinding;
  nextProject?: ShortcutBinding;
  prevProject?: ShortcutBinding;
  newTask?: ShortcutBinding;
  nextAgent?: ShortcutBinding;
  prevAgent?: ShortcutBinding;
}

export interface InterfaceSettings {
  autoRightSidebarBehavior?: boolean;
}

export interface AppSettings {
  repository: RepositorySettings;
  projectPrep: {
    autoInstallOnOpenInEditor: boolean;
  };
  browserPreview?: {
    enabled: boolean;
    engine: 'chromium';
  };
  notifications?: {
    enabled: boolean;
    sound: boolean;
  };
  mcp?: {
    context7?: {
      enabled: boolean;
      installHintsDismissed?: Record<string, boolean>;
    };
  };
  defaultProvider?: ProviderId;
  tasks?: {
    autoGenerateName: boolean;
    autoApproveByDefault: boolean;
    lastAgentRuns?: Array<{ agent: ProviderId; runs: number }>;
  };
  projects?: {
    defaultDirectory: string;
  };
  keyboard?: KeyboardSettings;
  interface?: InterfaceSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  repository: {
    branchPrefix: 'emdash',
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
    lastAgentRuns: [{ agent: DEFAULT_PROVIDER_ID, runs: 1 }],
  },
  projects: {
    defaultDirectory: join(homedir(), 'emdash-projects'),
  },
  keyboard: {
    commandPalette: { key: 'k', modifier: 'cmd' },
    settings: { key: ',', modifier: 'cmd' },
    toggleLeftSidebar: { key: 'b', modifier: 'cmd' },
    toggleRightSidebar: { key: '.', modifier: 'cmd' },
    toggleTheme: { key: 't', modifier: 'cmd' },
    toggleKanban: { key: 'p', modifier: 'cmd' },
    toggleEditor: { key: 'e', modifier: 'cmd' },
    nextProject: { key: 'ArrowRight', modifier: 'cmd' },
    prevProject: { key: 'ArrowLeft', modifier: 'cmd' },
    newTask: { key: 'n', modifier: 'cmd' },
    nextAgent: { key: 'k', modifier: 'cmd+shift' },
    prevAgent: { key: 'j', modifier: 'cmd+shift' },
  },
  interface: {
    autoRightSidebarBehavior: false,
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
      branchPrefix: DEFAULT_SETTINGS.repository.branchPrefix,
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
  };

  // Repository
  const repo = input?.repository ?? DEFAULT_SETTINGS.repository;
  let prefix = String(repo?.branchPrefix ?? DEFAULT_SETTINGS.repository.branchPrefix);
  prefix = prefix.trim().replace(/\/+$/, ''); // remove trailing slashes
  if (!prefix) prefix = DEFAULT_SETTINGS.repository.branchPrefix;
  if (prefix.length > 50) prefix = prefix.slice(0, 50);
  const push = Boolean(repo?.pushOnCreate ?? DEFAULT_SETTINGS.repository.pushOnCreate);

  out.repository.branchPrefix = prefix;
  out.repository.pushOnCreate = push;
  // Project prep
  const prep = (input as any)?.projectPrep || {};
  out.projectPrep.autoInstallOnOpenInEditor = Boolean(
    prep?.autoInstallOnOpenInEditor ?? DEFAULT_SETTINGS.projectPrep.autoInstallOnOpenInEditor
  );

  const bp = (input as any)?.browserPreview || {};
  out.browserPreview = {
    enabled: Boolean(bp?.enabled ?? DEFAULT_SETTINGS.browserPreview!.enabled),
    engine: 'chromium',
  };

  const notif = (input as any)?.notifications || {};
  out.notifications = {
    enabled: Boolean(notif?.enabled ?? DEFAULT_SETTINGS.notifications!.enabled),
    sound: Boolean(notif?.sound ?? DEFAULT_SETTINGS.notifications!.sound),
  };

  // MCP
  const mcp = (input as any)?.mcp || {};
  const c7 = mcp?.context7 || {};
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
  const defaultProvider = (input as any)?.defaultProvider;
  out.defaultProvider = isValidProviderId(defaultProvider)
    ? defaultProvider
    : DEFAULT_SETTINGS.defaultProvider!;

  const normalizeAgentRuns = (
    value: any,
    fallbackAgent: ProviderId
  ): Array<{ agent: ProviderId; runs: number }> => {
    const items = Array.isArray(value) ? value : [];
    const seen = new Set<ProviderId>();
    const normalized: Array<{ agent: ProviderId; runs: number }> = [];

    for (const item of items) {
      const agent = (item as any)?.agent;
      if (!isValidProviderId(agent) || seen.has(agent)) continue;

      const rawRuns = Number((item as any)?.runs);
      const rounded = Number.isFinite(rawRuns) ? Math.round(rawRuns) : 1;
      const runs = Math.max(1, Math.min(4, rounded));

      normalized.push({ agent, runs });
      seen.add(agent);
    }

    if (!normalized.length) {
      normalized.push({ agent: fallbackAgent, runs: 1 });
    }

    return normalized;
  };

  // Tasks
  const tasks = (input as any)?.tasks || {};
  out.tasks = {
    autoGenerateName: Boolean(tasks?.autoGenerateName ?? DEFAULT_SETTINGS.tasks!.autoGenerateName),
    autoApproveByDefault: Boolean(
      tasks?.autoApproveByDefault ?? DEFAULT_SETTINGS.tasks!.autoApproveByDefault
    ),
    lastAgentRuns: normalizeAgentRuns(
      tasks?.lastAgentRuns,
      out.defaultProvider || DEFAULT_PROVIDER_ID
    ),
  };

  // Projects
  const projects = (input as any)?.projects || {};
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

  // Keyboard
  const keyboard = (input as any)?.keyboard || {};
  const validModifiers: ShortcutModifier[] = ['cmd', 'ctrl', 'shift', 'alt', 'option', 'cmd+shift'];
  const normalizeBinding = (binding: any, defaultBinding: ShortcutBinding): ShortcutBinding => {
    if (!binding || typeof binding !== 'object') return defaultBinding;
    const key =
      typeof binding.key === 'string' && binding.key.length === 1
        ? binding.key.toLowerCase()
        : defaultBinding.key;
    const modifier = validModifiers.includes(binding.modifier)
      ? binding.modifier
      : defaultBinding.modifier;
    return { key, modifier };
  };
  out.keyboard = {
    commandPalette: normalizeBinding(
      keyboard.commandPalette,
      DEFAULT_SETTINGS.keyboard!.commandPalette!
    ),
    settings: normalizeBinding(keyboard.settings, DEFAULT_SETTINGS.keyboard!.settings!),
    toggleLeftSidebar: normalizeBinding(
      keyboard.toggleLeftSidebar,
      DEFAULT_SETTINGS.keyboard!.toggleLeftSidebar!
    ),
    toggleRightSidebar: normalizeBinding(
      keyboard.toggleRightSidebar,
      DEFAULT_SETTINGS.keyboard!.toggleRightSidebar!
    ),
    toggleTheme: normalizeBinding(keyboard.toggleTheme, DEFAULT_SETTINGS.keyboard!.toggleTheme!),
    toggleKanban: normalizeBinding(keyboard.toggleKanban, DEFAULT_SETTINGS.keyboard!.toggleKanban!),
    toggleEditor: normalizeBinding(keyboard.toggleEditor, DEFAULT_SETTINGS.keyboard!.toggleEditor!),
    nextProject: normalizeBinding(keyboard.nextProject, DEFAULT_SETTINGS.keyboard!.nextProject!),
    prevProject: normalizeBinding(keyboard.prevProject, DEFAULT_SETTINGS.keyboard!.prevProject!),
    newTask: normalizeBinding(keyboard.newTask, DEFAULT_SETTINGS.keyboard!.newTask!),
    nextAgent: normalizeBinding(keyboard.nextAgent, DEFAULT_SETTINGS.keyboard!.nextAgent!),
    prevAgent: normalizeBinding(keyboard.prevAgent, DEFAULT_SETTINGS.keyboard!.prevAgent!),
  };

  // Interface
  const iface = (input as any)?.interface || {};
  out.interface = {
    autoRightSidebarBehavior: Boolean(
      iface?.autoRightSidebarBehavior ?? DEFAULT_SETTINGS.interface!.autoRightSidebarBehavior
    ),
  };

  return out;
}
