import {
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS,
  type ProjectSettings,
  type ShareableProjectSettings,
  type ShareableProjectSettingsWriteField,
} from './project-settings';

type ShareableFieldAccessor = {
  path: string[];
  get(settings: ShareableProjectSettings): unknown;
  set(settings: ShareableProjectSettings, value: unknown): void;
  clear(settings: ShareableProjectSettings): void;
  displayValue(settings: ShareableProjectSettings): string | null;
};

function ensureScripts(
  settings: ShareableProjectSettings
): NonNullable<ShareableProjectSettings['scripts']> {
  settings.scripts ??= {};
  return settings.scripts;
}

function displayText(value: string | undefined): string | null {
  return value?.trim() ? value : null;
}

function compactScripts(settings: ShareableProjectSettings): void {
  if (settings.scripts && Object.values(settings.scripts).every((value) => value === undefined)) {
    delete settings.scripts;
  }
}

export const SHAREABLE_FIELD_ACCESSORS = {
  preservePatterns: {
    path: ['preservePatterns'],
    get: (settings) => settings.preservePatterns,
    set: (settings, value) => {
      settings.preservePatterns = value as string[] | undefined;
    },
    clear: (settings) => {
      delete settings.preservePatterns;
    },
    displayValue: (settings) => {
      const value = settings.preservePatterns?.filter((pattern) => pattern.trim());
      return value?.length ? value.join('\n') : null;
    },
  },
  shellSetup: {
    path: ['shellSetup'],
    get: (settings) => settings.shellSetup,
    set: (settings, value) => {
      settings.shellSetup = value as string | undefined;
    },
    clear: (settings) => {
      delete settings.shellSetup;
    },
    displayValue: (settings) => displayText(settings.shellSetup),
  },
  'scripts.setup': {
    path: ['scripts', 'setup'],
    get: (settings) => settings.scripts?.setup,
    set: (settings, value) => {
      ensureScripts(settings).setup = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.setup;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.setup),
  },
  'scripts.run': {
    path: ['scripts', 'run'],
    get: (settings) => settings.scripts?.run,
    set: (settings, value) => {
      ensureScripts(settings).run = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.run;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.run),
  },
  'scripts.teardown': {
    path: ['scripts', 'teardown'],
    get: (settings) => settings.scripts?.teardown,
    set: (settings, value) => {
      ensureScripts(settings).teardown = value as string | undefined;
    },
    clear: (settings) => {
      if (settings.scripts) delete settings.scripts.teardown;
      compactScripts(settings);
    },
    displayValue: (settings) => displayText(settings.scripts?.teardown),
  },
} satisfies Record<ShareableProjectSettingsWriteField, ShareableFieldAccessor>;

export function clearShareableProjectSettingsFields<T extends ProjectSettings>(
  settings: T,
  fields: ShareableProjectSettingsWriteField[]
): T {
  const next: ProjectSettings = {
    ...settings,
    preservePatterns: settings.preservePatterns ? [...settings.preservePatterns] : undefined,
    scripts: settings.scripts ? { ...settings.scripts } : undefined,
  };

  for (const field of fields) {
    SHAREABLE_FIELD_ACCESSORS[field].clear(next);
  }

  return next as T;
}

export function mergeShareableProjectSettings(
  ...sources: ShareableProjectSettings[]
): ShareableProjectSettings {
  const next: ShareableProjectSettings = {};

  for (const source of sources) {
    for (const field of SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS) {
      const value = SHAREABLE_FIELD_ACCESSORS[field].get(source);
      if (value !== undefined) {
        SHAREABLE_FIELD_ACCESSORS[field].set(next, value);
      }
    }
  }

  return next;
}
