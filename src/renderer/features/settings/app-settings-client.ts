import { rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';

export const APP_SETTINGS_STALE_TIME_MS = 5 * 60_000;

export type SettingsMeta<K extends AppSettingsKey> = {
  value: AppSettings[K];
  defaults: AppSettings[K];
  overrides: Partial<AppSettings[K]>;
};

export function appSettingsMetaQueryKey<K extends AppSettingsKey>(key: K) {
  return ['appSettings', key, 'meta'] as const;
}

const appSettingsAllQueryKey = ['appSettings', 'all'] as const;

export function mergeAppSettingsValue<K extends AppSettingsKey>(
  current: AppSettings[K] | undefined,
  partial: Partial<AppSettings[K]>
): AppSettings[K] {
  if (Array.isArray(partial)) {
    return partial as unknown as AppSettings[K];
  }
  if (
    typeof partial === 'object' &&
    partial !== null &&
    typeof current === 'object' &&
    current !== null
  ) {
    return { ...current, ...partial } as AppSettings[K];
  }
  return partial as AppSettings[K];
}

export function requestAppSettingsMeta<K extends AppSettingsKey>(key: K): Promise<SettingsMeta<K>> {
  return rpc.appSettings.getWithMeta(key) as Promise<SettingsMeta<K>>;
}

export function fetchAppSettingsMeta<K extends AppSettingsKey>(key: K): Promise<SettingsMeta<K>> {
  return queryClient.fetchQuery({
    queryKey: appSettingsMetaQueryKey(key),
    queryFn: () => requestAppSettingsMeta(key),
    staleTime: APP_SETTINGS_STALE_TIME_MS,
  });
}

export function setAppSettingsValueInCache<K extends AppSettingsKey>(
  key: K,
  value: AppSettings[K]
): void {
  queryClient.setQueryData<SettingsMeta<K> | undefined>(appSettingsMetaQueryKey(key), (old) =>
    old ? { ...old, value } : old
  );
  queryClient.setQueryData<AppSettings | undefined>(appSettingsAllQueryKey, (all) =>
    all ? { ...all, [key]: value } : all
  );
}

export function getAppSettingsMetaFromCache<K extends AppSettingsKey>(
  key: K
): SettingsMeta<K> | undefined {
  return queryClient.getQueryData<SettingsMeta<K>>(appSettingsMetaQueryKey(key));
}

export function getAllAppSettingsFromCache(): AppSettings | undefined {
  return queryClient.getQueryData<AppSettings>(appSettingsAllQueryKey);
}

export function restoreAppSettingsCache<K extends AppSettingsKey>(
  key: K,
  meta: SettingsMeta<K> | undefined,
  all: AppSettings | undefined
): void {
  queryClient.setQueryData(appSettingsMetaQueryKey(key), meta);
  queryClient.setQueryData(appSettingsAllQueryKey, all);
}

export function updateAppSettingsRequest<K extends AppSettingsKey>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  return rpc.appSettings.update(key, value) as Promise<void>;
}

export function resetAppSettingsRequest<K extends AppSettingsKey>(key: K): Promise<void> {
  return rpc.appSettings.reset(key) as Promise<void>;
}

export function resetAppSettingsFieldRequest<K extends AppSettingsKey>(
  key: K,
  field: keyof AppSettings[K]
): Promise<void> {
  return rpc.appSettings.resetField(key, field as string) as Promise<void>;
}

export function invalidateAppSettingsKey<K extends AppSettingsKey>(key: K): void {
  void queryClient.invalidateQueries({ queryKey: appSettingsMetaQueryKey(key) });
  void queryClient.invalidateQueries({ queryKey: appSettingsAllQueryKey });
}
