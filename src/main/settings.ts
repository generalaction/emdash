import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderId } from '@shared/providers/registry';
import { isValidProviderId } from '@shared/providers/registry';
import { isValidOpenInAppId, type CustomOpenInApp } from '@shared/openInApps';
import {
  isNotificationSoundProfile,
  type NotificationSoundProfile,
} from '@shared/notificationSounds';
import {
  DEFAULT_REVIEW_AGENT,
  DEFAULT_REVIEW_PROMPT,
  type ReviewSettings,
} from '@shared/reviewPreset';

export type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends object
    ? DeepPartial<NonNullable<T[K]>> | Extract<T[K], null>
    : T[K];
};

export type AppSettingsUpdate = DeepPartial<AppSettings>;

const DEFAULT_PROVIDER_ID: ProviderId = 'claude';
const IS_MAC = process.platform === 'darwin';

export interface RepositorySettings {
  branchPrefix: string; // e.g., 'emdash'
  pushOnCreate: boolean;
  autoCloseLinkedIssuesOnPrCreate: boolean;
}

export type ShortcutModifier =
  | 'cmd'
  | 'ctrl'
  | 'shift'
  | 'alt'
  | 'option'
  | 'cmd+shift'
  | 'ctrl+shift';

export interface ShortcutBinding {
  key: string;
  modifier: ShortcutModifier;
}

export type KeyboardShortcutBinding = ShortcutBinding | null;

export interface KeyboardSettings {
  commandPalette?: KeyboardShortcutBinding;
  settings?: KeyboardShortcutBinding;
  toggleLeftSidebar?: KeyboardShortcutBinding;
  toggleRightSidebar?: KeyboardShortcutBinding;
  toggleTheme?: KeyboardShortcutBinding;
  toggleKanban?: KeyboardShortcutBinding;
  toggleEditor?: KeyboardShortcutBinding;
  closeModal?: KeyboardShortcutBinding;
  nextProject?: KeyboardShortcutBinding;
  prevProject?: KeyboardShortcutBinding;
  newTask?: KeyboardShortcutBinding;
  nextAgent?: KeyboardShortcutBinding;
  prevAgent?: KeyboardShortcutBinding;
  openInEditor?: KeyboardShortcutBinding;
}

export interface InterfaceSettings {
  autoRightSidebarBehavior?: boolean;
  showResourceMonitor?: boolean;
  theme?: 'light' | 'dark' | 'dark-black' | 'system';
  taskHoverAction?: 'delete' | 'archive';
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
  extraArgs?: string;
  env?: Record<string, string>;
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
    osNotifications: boolean;
    soundFocusMode: 'always' | 'unfocused';
    soundProfile: NotificationSoundProfile;
  };
  defaultProvider?: ProviderId;
  review?: ReviewSettings;
  tasks?: {
    autoGenerateName: boolean;
    autoInferTaskNames: boolean;
    autoApproveByDefault: boolean;
    createWorktreeByDefault: boolean;
    autoTrustWorktrees: boolean;
  };
  projects?: {
    defaultDirectory: string;
  };
  keyboard?: KeyboardSettings;
  interface?: InterfaceSettings;
  providerConfigs?: ProviderCustomConfigs;
  terminal?: {
    fontFamily: string;
    fontSize: number;
    autoCopyOnSelection: boolean;
    macOptionIsMeta: boolean;
  };
  defaultOpenInApp?: string;
  hiddenOpenInApps?: string[];
  customOpenInApps?: CustomOpenInApp[];
  changelog?: {
    dismissedVersions: string[];
  };
}

function getPlatformTaskSwitchDefaults(): { next: ShortcutBinding; prev: ShortcutBinding } {
  if (IS_MAC) {
    return {
      next: { key: ']', modifier: 'cmd' },
      prev: { key: '[', modifier: 'cmd' },
    };
  }

  return {
    next: { key: 'Tab', modifier: 'ctrl' },
    prev: { key: 'Tab', modifier: 'ctrl+shift' },
  };
}

const TASK_SWITCH_DEFAULTS = getPlatformTaskSwitchDefaults();

const DEFAULT_SETTINGS: AppSettings = {
  repository: {
    branchPrefix: 'emdash',
    pushOnCreate: true,
    autoCloseLinkedIssuesOnPrCreate: true,
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
    osNotifications: true,
    soundFocusMode: 'always',
    soundProfile: 'default',
  },
  defaultProvider: DEFAULT_PROVIDER_ID,
  review: {
    enabled: false,
    agent: DEFAULT_REVIEW_AGENT,
    prompt: DEFAULT_REVIEW_PROMPT,
  },
  tasks: {
    autoGenerateName: true,
    autoInferTaskNames: true,
    autoApproveByDefault: false,
    createWorktreeByDefault: true,
    autoTrustWorktrees: true,
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
    nextProject: TASK_SWITCH_DEFAULTS.next,
    prevProject: TASK_SWITCH_DEFAULTS.prev,
    newTask: { key: 'n', modifier: 'cmd' },
    nextAgent: { key: ']', modifier: 'cmd+shift' },
    prevAgent: { key: '[', modifier: 'cmd+shift' },
    openInEditor: { key: 'o', modifier: 'cmd' },
  },
  interface: {
    autoRightSidebarBehavior: false,
    showResourceMonitor: false,
    theme: 'system',
    taskHoverAction: 'delete',
  },
  providerConfigs: {},
  terminal: {
    fontFamily: '',
    fontSize: 0,
    autoCopyOnSelection: false,
    macOptionIsMeta: false,
  },
  defaultOpenInApp: 'terminal',
  hiddenOpenInApps: [],
  customOpenInApps: [],
  changelog: {
    dismissedVersions: [],
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

function normalizeShortcutKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === 'esc' || lower === 'escape') return 'Escape';
  if (lower === 'tab') return 'Tab';
  if (lower === 'arrowleft' || lower === 'left') return 'ArrowLeft';
  if (lower === 'arrowright' || lower === 'right') return 'ArrowRight';
  if (lower === 'arrowup' || lower === 'up') return 'ArrowUp';
  if (lower === 'arrowdown' || lower === 'down') return 'ArrowDown';

  // Allow single printable, non-whitespace characters.
  if (trimmed.length === 1 && /\S/u.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return null;
}

function normalizeShortcutModifier(value: unknown, fallback: ShortcutModifier): ShortcutModifier {
  if (typeof value !== 'string') return fallback;

  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, ShortcutModifier> = {
    cmd: 'cmd',
    command: 'cmd',
    meta: 'cmd',
    ctrl: 'ctrl',
    control: 'ctrl',
    shift: 'shift',
    alt: 'alt',
    option: 'option',
    opt: 'option',
    'cmd+shift': 'cmd+shift',
    'shift+cmd': 'cmd+shift',
    'command+shift': 'cmd+shift',
    'shift+command': 'cmd+shift',
    'meta+shift': 'cmd+shift',
    'shift+meta': 'cmd+shift',
    'ctrl+shift': 'ctrl+shift',
    'shift+ctrl': 'ctrl+shift',
    'control+shift': 'ctrl+shift',
    'shift+control': 'ctrl+shift',
  };

  return aliases[normalized] ?? fallback;
}

function isBinding(
  binding: KeyboardShortcutBinding | undefined,
  modifier: ShortcutModifier,
  key: string
): boolean {
  return binding?.modifier === modifier && binding?.key === key;
}

function assertNoKeyboardShortcutConflicts(keyboard?: KeyboardSettings): void {
  if (!keyboard) return;

  const seen = new Map<string, string>();

  for (const [shortcutName, binding] of Object.entries(keyboard)) {
    if (!binding?.key || !binding?.modifier) continue;

    const normalizedKey = binding.key.toLowerCase();
    const signature = `${binding.modifier}:${normalizedKey}`;
    const conflictWith = seen.get(signature);

    if (conflictWith) {
      throw new Error(
        `Keyboard shortcut conflict: "${shortcutName}" duplicates "${conflictWith}".`
      );
    }

    seen.set(signature, shortcutName);
  }
}

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
export function updateAppSettings(partial: AppSettingsUpdate): AppSettings {
  const current = getAppSettings();
  const merged = deepMerge(current, partial as Partial<AppSettings>);
  const next = normalizeSettings(merged);
  if (partial.keyboard) {
    assertNoKeyboardShortcutConflicts(next.keyboard);
  }
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
export function normalizeSettings(input: AppSettings): AppSettings {
  const out: AppSettings = {
    repository: {
      branchPrefix: DEFAULT_SETTINGS.repository.branchPrefix,
      pushOnCreate: DEFAULT_SETTINGS.repository.pushOnCreate,
      autoCloseLinkedIssuesOnPrCreate: DEFAULT_SETTINGS.repository.autoCloseLinkedIssuesOnPrCreate,
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
      osNotifications: DEFAULT_SETTINGS.notifications!.osNotifications,
      soundFocusMode: DEFAULT_SETTINGS.notifications!.soundFocusMode,
      soundProfile: DEFAULT_SETTINGS.notifications!.soundProfile,
    },
  };

  // Repository
  const repo = input?.repository ?? DEFAULT_SETTINGS.repository;
  let prefix = String(repo?.branchPrefix ?? DEFAULT_SETTINGS.repository.branchPrefix);
  prefix = prefix.trim().replace(/\/+$/, ''); // remove trailing slashes
  if (!prefix) prefix = DEFAULT_SETTINGS.repository.branchPrefix;
  if (prefix.length > 50) prefix = prefix.slice(0, 50);
  const push = Boolean(repo?.pushOnCreate ?? DEFAULT_SETTINGS.repository.pushOnCreate);
  const autoCloseLinkedIssuesOnPrCreate = Boolean(
    repo?.autoCloseLinkedIssuesOnPrCreate ??
      DEFAULT_SETTINGS.repository.autoCloseLinkedIssuesOnPrCreate
  );

  out.repository.branchPrefix = prefix;
  out.repository.pushOnCreate = push;
  out.repository.autoCloseLinkedIssuesOnPrCreate = autoCloseLinkedIssuesOnPrCreate;
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
  const rawFocusMode = notif?.soundFocusMode;
  out.notifications = {
    enabled: Boolean(notif?.enabled ?? DEFAULT_SETTINGS.notifications!.enabled),
    sound: Boolean(notif?.sound ?? DEFAULT_SETTINGS.notifications!.sound),
    osNotifications: Boolean(
      notif?.osNotifications ?? DEFAULT_SETTINGS.notifications!.osNotifications
    ),
    soundFocusMode:
      rawFocusMode === 'always' || rawFocusMode === 'unfocused'
        ? rawFocusMode
        : DEFAULT_SETTINGS.notifications!.soundFocusMode,
    soundProfile: isNotificationSoundProfile(notif?.soundProfile)
      ? notif.soundProfile
      : DEFAULT_SETTINGS.notifications!.soundProfile,
  };

  // Default provider
  const defaultProvider = (input as any)?.defaultProvider;
  out.defaultProvider = isValidProviderId(defaultProvider)
    ? defaultProvider
    : DEFAULT_SETTINGS.defaultProvider!;

  const review = (input as any)?.review || {};
  const reviewAgent = isValidProviderId(review?.agent)
    ? review.agent
    : DEFAULT_SETTINGS.review!.agent;
  const reviewPrompt =
    typeof review?.prompt === 'string' && review.prompt.trim()
      ? review.prompt.trim()
      : DEFAULT_SETTINGS.review!.prompt;
  out.review = {
    enabled: Boolean(review?.enabled ?? DEFAULT_SETTINGS.review!.enabled),
    agent: reviewAgent,
    prompt: reviewPrompt,
  };

  // Tasks
  const tasks = (input as any)?.tasks || {};
  out.tasks = {
    autoGenerateName: Boolean(tasks?.autoGenerateName ?? DEFAULT_SETTINGS.tasks!.autoGenerateName),
    autoInferTaskNames: Boolean(
      tasks?.autoInferTaskNames ?? DEFAULT_SETTINGS.tasks!.autoInferTaskNames
    ),
    autoApproveByDefault: Boolean(
      tasks?.autoApproveByDefault ?? DEFAULT_SETTINGS.tasks!.autoApproveByDefault
    ),
    createWorktreeByDefault: Boolean(
      tasks?.createWorktreeByDefault ?? DEFAULT_SETTINGS.tasks!.createWorktreeByDefault
    ),
    autoTrustWorktrees: Boolean(
      tasks?.autoTrustWorktrees ?? DEFAULT_SETTINGS.tasks!.autoTrustWorktrees
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
  const normalizeBinding = (
    binding: any,
    defaultBinding: ShortcutBinding
  ): KeyboardShortcutBinding => {
    if (binding === null) return null;
    if (!binding || typeof binding !== 'object') return defaultBinding;
    const key = normalizeShortcutKey(binding.key) ?? defaultBinding.key;
    const modifier = normalizeShortcutModifier(binding.modifier, defaultBinding.modifier);
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
    openInEditor: normalizeBinding(keyboard.openInEditor, DEFAULT_SETTINGS.keyboard!.openInEditor!),
  };
  const platformTaskDefaults = getPlatformTaskSwitchDefaults();
  const isLegacyArrowPair =
    isBinding(out.keyboard.nextProject!, 'cmd', 'ArrowRight') &&
    isBinding(out.keyboard.prevProject!, 'cmd', 'ArrowLeft');
  const isLegacyTabPair =
    isBinding(out.keyboard.nextProject!, 'ctrl', 'Tab') &&
    isBinding(out.keyboard.prevProject!, 'ctrl+shift', 'Tab');
  if (isLegacyArrowPair || (IS_MAC && isLegacyTabPair)) {
    out.keyboard.nextProject = platformTaskDefaults.next;
    out.keyboard.prevProject = platformTaskDefaults.prev;
  }

  // Interface
  const iface = (input as any)?.interface || {};
  out.interface = {
    autoRightSidebarBehavior: Boolean(
      iface?.autoRightSidebarBehavior ?? DEFAULT_SETTINGS.interface!.autoRightSidebarBehavior
    ),
    showResourceMonitor: Boolean(
      iface?.showResourceMonitor ?? DEFAULT_SETTINGS.interface!.showResourceMonitor
    ),
    theme: ['light', 'dark', 'dark-black', 'system'].includes(iface?.theme)
      ? iface.theme
      : DEFAULT_SETTINGS.interface!.theme,
    taskHoverAction: iface?.taskHoverAction === 'archive' ? 'archive' : 'delete',
  };

  // Provider custom configs
  const providerConfigs = (input as any)?.providerConfigs || {};
  out.providerConfigs = {};
  if (providerConfigs && typeof providerConfigs === 'object') {
    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (config && typeof config === 'object') {
        const c = config as Record<string, unknown>;
        let env: Record<string, string> | undefined;
        if (c.env && typeof c.env === 'object') {
          env = {};
          for (const [k, v] of Object.entries(c.env)) {
            if (
              typeof k === 'string' &&
              typeof v === 'string' &&
              /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)
            ) {
              env[k] = v;
            }
          }
          if (Object.keys(env).length === 0) env = undefined;
        }
        out.providerConfigs[providerId] = {
          ...(typeof c.cli === 'string' ? { cli: c.cli } : {}),
          ...(typeof c.resumeFlag === 'string' ? { resumeFlag: c.resumeFlag } : {}),
          ...(typeof c.defaultArgs === 'string' ? { defaultArgs: c.defaultArgs } : {}),
          ...(typeof c.autoApproveFlag === 'string' ? { autoApproveFlag: c.autoApproveFlag } : {}),
          ...(typeof c.initialPromptFlag === 'string'
            ? { initialPromptFlag: c.initialPromptFlag }
            : {}),
          ...(typeof c.extraArgs === 'string' ? { extraArgs: c.extraArgs } : {}),
          ...(env ? { env } : {}),
        };
      }
    }
  }

  // Terminal
  const term = (input as any)?.terminal || {};
  const fontFamily = String(term?.fontFamily ?? '').trim();
  const autoCopyOnSelection = Boolean(term?.autoCopyOnSelection ?? false);
  const macOptionIsMeta = Boolean(term?.macOptionIsMeta ?? false);
  const rawFontSize = term?.fontSize;
  let fontSize = 0;
  if (typeof rawFontSize === 'number' && Number.isFinite(rawFontSize)) {
    const clamped = Math.round(rawFontSize);
    fontSize = clamped >= 8 && clamped <= 24 ? clamped : 0;
  }
  out.terminal = { fontFamily, fontSize, autoCopyOnSelection, macOptionIsMeta };

  // Custom Open In Apps
  const rawCustom = (input as any)?.customOpenInApps;
  if (Array.isArray(rawCustom)) {
    out.customOpenInApps = rawCustom
      .filter(
        (c: unknown): c is CustomOpenInApp =>
          c !== null &&
          typeof c === 'object' &&
          typeof (c as any).id === 'string' &&
          (c as any).id.trim() !== '' &&
          typeof (c as any).label === 'string' &&
          (c as any).label.trim() !== '' &&
          typeof (c as any).openCommand === 'string' &&
          (c as any).openCommand.trim() !== ''
      )
      .map((c) => {
        const entry: CustomOpenInApp = {
          id: c.id.trim(),
          label: c.label.trim(),
          openCommand: c.openCommand.trim(),
        };
        // checkCommand is interpolated into `command -v ${cmd}`, so restrict to safe basenames
        if (typeof c.checkCommand === 'string') {
          const cmd = c.checkCommand.trim();
          if (cmd && /^[a-zA-Z0-9_\-./]+$/.test(cmd)) {
            entry.checkCommand = cmd;
          }
        }
        if (typeof c.iconPath === 'string' && c.iconPath.trim()) {
          entry.iconPath = c.iconPath.trim();
        }
        return entry;
      });
  } else {
    out.customOpenInApps = [];
  }
  const customIds = new Set((out.customOpenInApps ?? []).map((c) => c.id));

  // Default Open In App (accept both built-in and custom IDs)
  const defaultOpenInApp = (input as any)?.defaultOpenInApp;
  out.defaultOpenInApp =
    typeof defaultOpenInApp === 'string' &&
    defaultOpenInApp.trim() &&
    (isValidOpenInAppId(defaultOpenInApp) || customIds.has(defaultOpenInApp))
      ? defaultOpenInApp
      : DEFAULT_SETTINGS.defaultOpenInApp!;

  // Hidden Open In Apps (accept both built-in and custom IDs)
  const rawHidden = (input as any)?.hiddenOpenInApps;
  if (Array.isArray(rawHidden)) {
    const validated = rawHidden.filter(
      (v: unknown): v is string =>
        typeof v === 'string' && v.trim() !== '' && (isValidOpenInAppId(v) || customIds.has(v))
    );
    out.hiddenOpenInApps = [...new Set(validated)];
  } else {
    out.hiddenOpenInApps = [];
  }

  const rawDismissedVersions = (input as any)?.changelog?.dismissedVersions;
  out.changelog = {
    dismissedVersions: Array.isArray(rawDismissedVersions)
      ? [
          ...new Set(
            rawDismissedVersions
              .filter((value: unknown): value is string => typeof value === 'string')
              .map((value) => value.trim().replace(/^v/i, ''))
              .filter(Boolean)
          ),
        ]
      : [],
  };

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
  return Object.fromEntries(Object.entries(configs).map(([key, value]) => [key, { ...value }]));
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
  const currentConfigs = { ...(settings.providerConfigs ?? {}) };

  if (config === undefined) {
    delete currentConfigs[providerId];
  } else {
    // Strip undefined values so removed fields (e.g. env after
    // deleting all env vars) don't linger from a previous save.
    const cleaned: ProviderCustomConfig = {};
    for (const [k, v] of Object.entries(config)) {
      if (v !== undefined) {
        cleaned[k as keyof ProviderCustomConfig] = v;
      }
    }
    if (Object.keys(cleaned).length > 0) {
      currentConfigs[providerId] = cleaned;
    } else {
      delete currentConfigs[providerId];
    }
  }

  // Write the full providerConfigs map directly to avoid deepMerge
  // preserving stale nested keys from the old config.
  const next = normalizeSettings({ ...settings, providerConfigs: currentConfigs });
  persistSettings(next);
  cached = next;
}
