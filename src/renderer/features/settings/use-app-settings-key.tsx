import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import {
  APP_SETTINGS_STALE_TIME_MS,
  appSettingsMetaQueryKey,
  getAllAppSettingsFromCache,
  invalidateAppSettingsKey,
  mergeAppSettingsValue,
  requestAppSettingsMeta,
  resetAppSettingsFieldRequest,
  resetAppSettingsRequest,
  restoreAppSettingsCache,
  setAppSettingsValueInCache,
  updateAppSettingsRequest,
  type SettingsMeta,
} from './app-settings-client';

export function useAppSettingsKey<K extends AppSettingsKey>(key: K) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SettingsMeta<K>>({
    queryKey: appSettingsMetaQueryKey(key),
    queryFn: () => requestAppSettingsMeta(key),
    staleTime: APP_SETTINGS_STALE_TIME_MS,
  });

  const updateMutation = useMutation<
    void,
    Error,
    Partial<AppSettings[K]>,
    { prev: SettingsMeta<K> | undefined; prevAll: AppSettings | undefined }
  >({
    mutationFn: (partial) => {
      const current = queryClient.getQueryData<SettingsMeta<K>>(appSettingsMetaQueryKey(key));
      const merged = mergeAppSettingsValue(current?.value, partial);
      return updateAppSettingsRequest(key, merged);
    },
    onMutate: async (partial) => {
      await queryClient.cancelQueries({ queryKey: appSettingsMetaQueryKey(key) });
      const prev = queryClient.getQueryData<SettingsMeta<K>>(appSettingsMetaQueryKey(key));
      const prevAll = getAllAppSettingsFromCache();
      const merged = mergeAppSettingsValue(prev?.value, partial);
      setAppSettingsValueInCache(key, merged);
      return { prev, prevAll };
    },
    onError: (_err, _partial, ctx) => {
      if (ctx) restoreAppSettingsCache(key, ctx.prev, ctx.prevAll);
      invalidateAppSettingsKey(key);
    },
    onSettled: () => {
      invalidateAppSettingsKey(key);
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: () => resetAppSettingsRequest(key),
    onSuccess: () => {
      invalidateAppSettingsKey(key);
    },
  });

  const resetFieldMutation = useMutation<void, Error, keyof AppSettings[K]>({
    mutationFn: (field) => resetAppSettingsFieldRequest(key, field),
    onSuccess: () => {
      invalidateAppSettingsKey(key);
    },
  });

  return {
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isLoading,
    isSaving: updateMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof AppSettings[K]) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    reset: resetMutation.mutate,
    resetField: (field: keyof AppSettings[K]) => resetFieldMutation.mutate(field),
  };
}
