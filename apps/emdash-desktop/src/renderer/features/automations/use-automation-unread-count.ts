import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { events, rpc } from '@renderer/lib/ipc';
import { isTerminalAutomationRunStatus } from '@shared/core/automations/automation-run';
import { automationRunChangedChannel } from '@shared/core/automations/automationEvents';

export const automationUnreadCountQueryKey = (lastReadAt: number) =>
  ['automations', 'unread-count', lastReadAt] as const;

export function useAutomationUnreadCount() {
  const { value: interfaceSettings, updateAsync } = useAppSettingsKey('interface');
  const lastReadAt = interfaceSettings?.automationsLastReadAt ?? 0;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lastReadAt !== 0 || interfaceSettings === undefined) return;
    void rpc.automations.getNotificationsBaselineTimestamp().then((baseline) => {
      void updateAsync({ automationsLastReadAt: baseline });
    });
  }, [interfaceSettings, lastReadAt, updateAsync]);

  const query = useQuery({
    queryKey: automationUnreadCountQueryKey(lastReadAt),
    queryFn: () => rpc.automations.countUnreadFinishedRuns(lastReadAt),
    enabled: lastReadAt > 0,
  });

  useEffect(() => {
    return events.on(automationRunChangedChannel, ({ run }) => {
      if (!isTerminalAutomationRunStatus(run.status)) return;
      void queryClient.invalidateQueries({ queryKey: ['automations', 'unread-count'] });
    });
  }, [queryClient]);

  return query.data ?? 0;
}

export function useMarkAutomationsRead() {
  const { updateAsync } = useAppSettingsKey('interface');
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await updateAsync({ automationsLastReadAt: Date.now() });
    void queryClient.invalidateQueries({ queryKey: ['automations', 'unread-count'] });
  }, [updateAsync, queryClient]);
}
