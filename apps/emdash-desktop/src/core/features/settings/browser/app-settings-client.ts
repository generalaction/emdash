import type { AppSettings, AppSettingsKey } from '@core/primitives/app-settings/api';
import { queryClient } from '@renderer/lib/query-client';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export const APP_SETTINGS_STALE_TIME_MS = 5 * 60_000;

export type SettingsMeta<K extends AppSettingsKey> = {
  value: AppSettings[K];
  defaults: AppSettings[K];
  overrides: Partial<AppSettings[K]>;
};

export function appSettingsMetaQueryKey<K extends AppSettingsKey>(key: K) {
  return ['appSettings', key, 'meta'] as const;
}

const appSettingsGcTime = <K extends AppSettingsKey>(key: K) =>
  key === 'interface' || key === 'browser' ? Infinity : undefined;

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
  return getDesktopWireClient().then((client) =>
    client.appSettings.getWithMeta({ key })
  ) as Promise<SettingsMeta<K>>;
}

export function fetchAppSettingsMeta<K extends AppSettingsKey>(key: K): Promise<SettingsMeta<K>> {
  return queryClient.fetchQuery({
    queryKey: appSettingsMetaQueryKey(key),
    queryFn: () => requestAppSettingsMeta(key),
    staleTime: APP_SETTINGS_STALE_TIME_MS,
    gcTime: appSettingsGcTime(key),
  });
}

export function prefetchAppSettingsKey<K extends AppSettingsKey>(key: K) {
  return queryClient.prefetchQuery({
    queryKey: appSettingsMetaQueryKey(key),
    queryFn: () => requestAppSettingsMeta(key),
    staleTime: APP_SETTINGS_STALE_TIME_MS,
    gcTime: appSettingsGcTime(key),
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

/** Synchronous read of the cached settings value. Returns undefined if not yet fetched. */
export function getAppSettingValueSnapshot<K extends AppSettingsKey>(
  key: K
): AppSettings[K] | undefined {
  return getAppSettingsMetaFromCache(key)?.value;
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
  return getDesktopWireClient().then((client) => client.appSettings.update({ key, value }));
}

export function resetAppSettingsRequest<K extends AppSettingsKey>(key: K): Promise<void> {
  return getDesktopWireClient().then((client) => client.appSettings.reset({ key }));
}

export function resetAppSettingsFieldRequest<K extends AppSettingsKey>(
  key: K,
  field: keyof AppSettings[K]
): Promise<void> {
  return getDesktopWireClient().then((client) =>
    client.appSettings.resetField({ key, field: field as string })
  );
}

export function invalidateAppSettingsKey<K extends AppSettingsKey>(key: K): void {
  void queryClient.invalidateQueries({ queryKey: appSettingsMetaQueryKey(key) });
  void queryClient.invalidateQueries({ queryKey: appSettingsAllQueryKey });
}
