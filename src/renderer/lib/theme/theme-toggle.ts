import type { AppSettings, Theme } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { getNextTheme } from './theme-toggle-model';

type ThemeMeta = {
  value: Theme;
  defaults: Theme;
  overrides: Partial<Theme>;
};

export async function toggleAppTheme(): Promise<void> {
  const meta = await queryClient.fetchQuery<ThemeMeta>({
    queryKey: ['appSettings', 'theme', 'meta'],
    queryFn: () => rpc.appSettings.getWithMeta('theme') as Promise<ThemeMeta>,
    staleTime: 5 * 60_000,
  });
  const next = getNextTheme(meta.value, window.matchMedia('(prefers-color-scheme: dark)').matches);

  const previousAll = queryClient.getQueryData<AppSettings>(['appSettings', 'all']);
  queryClient.setQueryData(['appSettings', 'theme', 'meta'], { ...meta, value: next });
  queryClient.setQueryData<AppSettings | undefined>(['appSettings', 'all'], (all) =>
    all ? { ...all, theme: next } : all
  );

  try {
    await rpc.appSettings.update('theme', next);
  } catch (error) {
    queryClient.setQueryData(['appSettings', 'theme', 'meta'], meta);
    queryClient.setQueryData(['appSettings', 'all'], previousAll);
    throw error;
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['appSettings', 'theme', 'meta'] });
    void queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
  }
}
