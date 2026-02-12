import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { ProviderId } from '@shared/providers/registry';
import { isValidProviderId } from '@shared/providers/registry';
import { isValidOpenInAppId, type OpenInAppId } from '@shared/openInApps';

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
  theme?: 'light' | 'dark' | 'dark-black' | 'system';
}

/**
 * Custom configuration for a CLI provider.
 * All fields are optional - if undefined, the default from registry.ts is used.
 * If set to empty string, the flag is disabled.
 */
export interface ProviderCustomConfig {
  cli?: string;
  resumeFlag?: string;
  defaultArgs?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
}

export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;

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
  };
  projects?: {
    defaultDirectory: string;
  };
  keyboard?: KeyboardSettings;
  interface?: InterfaceSettings;
  providerConfigs?: ProviderCustomConfigs;
  terminal?: {
    fontFamily: string;
  };
  defaultOpenInApp?: OpenInAppId;
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
    theme: 'system',
  },
  providerConfigs: {},
  terminal: {
    fontFamily: '',
  },
  defaultOpenInApp: 'terminal',
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

  // Tasks
  const tasks = (input as any)?.tasks || {};
  out.tasks = {
    autoGenerateName: Boolean(tasks?.autoGenerateName ?? DEFAULT_SETTINGS.tasks!.autoGenerateName),
    autoApproveByDefault: Boolean(
      tasks?.autoApproveByDefault ?? DEFAULT_SETTINGS.tasks!.autoApproveByDefault
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
    theme: ['light', 'dark', 'dark-black', 'system'].includes(iface?.theme)
      ? iface.theme
      : DEFAULT_SETTINGS.interface!.theme,
  };

  // Provider custom configs
  const providerConfigs = (input as any)?.providerConfigs || {};
  out.providerConfigs = {};
  if (providerConfigs && typeof providerConfigs === 'object') {
    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (config && typeof config === 'object') {
        const c = config as Record<string, unknown>;
        out.providerConfigs[providerId] = {
          ...(typeof c.cli === 'string' ? { cli: c.cli } : {}),
          ...(typeof c.resumeFlag === 'string' ? { resumeFlag: c.resumeFlag } : {}),
          ...(typeof c.defaultArgs === 'string' ? { defaultArgs: c.defaultArgs } : {}),
          ...(typeof c.autoApproveFlag === 'string' ? { autoApproveFlag: c.autoApproveFlag } : {}),
          ...(typeof c.initialPromptFlag === 'string'
            ? { initialPromptFlag: c.initialPromptFlag }
            : {}),
        };
      }
    }
  }

  // Terminal
  const term = (input as any)?.terminal || {};
  const fontFamily = String(term?.fontFamily ?? '').trim();
  out.terminal = { fontFamily };

  // Default Open In App
  const defaultOpenInApp = (input as any)?.defaultOpenInApp;
  out.defaultOpenInApp = isValidOpenInAppId(defaultOpenInApp)
    ? defaultOpenInApp
    : DEFAULT_SETTINGS.defaultOpenInApp!;

  return out;
}

/**
 * Get custom configuration for a specific provider.
 * Returns a shallow copy to prevent cache corruption from external mutations.
 */
export function getProviderCustomConfig(providerId: string): ProviderCustomConfig | undefined {
  const settings = getAppSettings();
  const config = settings.providerConfigs?.[providerId];
  return config ? { ...config } : undefined;
}

/**
 * Get all provider custom configurations.
 * Returns a deep copy to prevent cache corruption from external mutations.
 */
export function getAllProviderCustomConfigs(): ProviderCustomConfigs {
  const settings = getAppSettings();
  const configs = settings.providerConfigs ?? {};
  // Return deep copy to prevent cache corruption
  return Object.fromEntries(
    Object.entries(configs).map(([key, value]) => [key, { ...value }])
  );
}

/**
 * Update custom configuration for a specific provider.
 * Pass undefined to remove the custom config and use defaults.
 */
export function updateProviderCustomConfig(
  providerId: string,
  config: ProviderCustomConfig | undefined
): void {
  const settings = getAppSettings();
  const currentConfigs = settings.providerConfigs ?? {};

  if (config === undefined) {
    // Remove the config
    const { [providerId]: _, ...rest } = currentConfigs;
    updateAppSettings({ providerConfigs: rest });
  } else {
    // Update/add the config
    updateAppSettings({
      providerConfigs: {
        ...currentConfigs,
        [providerId]: config,
      },
    });
  }
}
