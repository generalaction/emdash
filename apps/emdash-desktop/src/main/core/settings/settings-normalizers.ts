import {
  normalizeExistingLocalWorktreeDirectory,
  resolveAndValidateLocalWorktreeDirectory,
} from '@main/core/projects/settings/local-worktree-directory';
import type { AppSettings, AppSettingsKey, LocalProjectSettings } from '@shared/core/app-settings';

type SettingStorageNormalizer<K extends AppSettingsKey> = (
  value: AppSettings[K],
  previousValue: AppSettings[K] | undefined
) => Promise<AppSettings[K]>;

type SettingReadNormalizer<K extends AppSettingsKey> = (
  value: AppSettings[K],
  defaults: AppSettings[K]
) => Promise<AppSettings[K]>;

type SettingStorageNormalizers = {
  [K in AppSettingsKey]?: SettingStorageNormalizer<K>;
};

type SettingReadNormalizers = {
  [K in AppSettingsKey]?: SettingReadNormalizer<K>;
};

async function normalizeLocalProjectSettingsForStorage(
  value: LocalProjectSettings,
  previousValue: LocalProjectSettings | undefined
) {
  if (value.defaultWorktreeDirectory === previousValue?.defaultWorktreeDirectory) {
    return value;
  }

  const defaultWorktreeDirectory = await resolveAndValidateLocalWorktreeDirectory(
    value.defaultWorktreeDirectory
  );
  if (!defaultWorktreeDirectory.success || !defaultWorktreeDirectory.data) {
    throw new Error('Invalid default worktree directory');
  }

  return {
    ...value,
    defaultWorktreeDirectory: defaultWorktreeDirectory.data,
  };
}

async function normalizeLocalProjectSettingsForRead(
  value: LocalProjectSettings,
  defaults: LocalProjectSettings
) {
  const fallbackDefaultWorktreeDirectoryPromise = normalizeExistingLocalWorktreeDirectory(
    defaults.defaultWorktreeDirectory
  );
  const defaultWorktreeDirectoryPromise =
    value.defaultWorktreeDirectory === defaults.defaultWorktreeDirectory
      ? fallbackDefaultWorktreeDirectoryPromise
      : normalizeExistingLocalWorktreeDirectory(value.defaultWorktreeDirectory);
  const [defaultWorktreeDirectory, fallbackDefaultWorktreeDirectory] = await Promise.all([
    defaultWorktreeDirectoryPromise,
    fallbackDefaultWorktreeDirectoryPromise,
  ]);

  const fallback = fallbackDefaultWorktreeDirectory.success
    ? fallbackDefaultWorktreeDirectory.data
    : defaults.defaultWorktreeDirectory;

  return {
    ...value,
    defaultWorktreeDirectory: defaultWorktreeDirectory.success
      ? defaultWorktreeDirectory.data
      : fallback,
  };
}

const storageNormalizers: SettingStorageNormalizers = {
  localProject: normalizeLocalProjectSettingsForStorage,
};

const readNormalizers: SettingReadNormalizers = {
  localProject: normalizeLocalProjectSettingsForRead,
};

export async function normalizeSettingValueForStorage<K extends AppSettingsKey>(
  key: K,
  value: AppSettings[K],
  previousValue?: AppSettings[K]
): Promise<AppSettings[K]> {
  const normalizer = storageNormalizers[key];
  return normalizer ? normalizer(value, previousValue) : value;
}

export async function normalizeSettingValueForRead<K extends AppSettingsKey>(
  key: K,
  value: AppSettings[K],
  defaults: AppSettings[K]
): Promise<AppSettings[K]> {
  const normalizer = readNormalizers[key];
  return normalizer ? normalizer(value, defaults) : value;
}
