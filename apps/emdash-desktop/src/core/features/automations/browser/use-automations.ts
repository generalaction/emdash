import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type {
  CreateAutomationParams,
  UpdateAutomationSettingsPatch,
} from '@core/primitives/automations/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export function useAutomations(projectId?: string) {
  const queryClient = useQueryClient();

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
  }

  function invalidateRuns(automationId?: string) {
    void queryClient.invalidateQueries({
      queryKey: automationId ? ['automations', 'runs', automationId] : ['automations', 'runs'],
    });
  }

  const automations = useQuery({
    queryKey: ['automations', projectId],
    queryFn: async () => (await getDesktopWireClient()).automations.listAutomations({ projectId }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: async (params: CreateAutomationParams) =>
      (await getDesktopWireClient()).automations.createAutomation(params),
    onSuccess: invalidateAutomations,
  });

  const updateSettings = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationSettingsPatch }) =>
      getDesktopWireClient().then((client) =>
        client.automations.updateAutomationSettings({ id, patch })
      ),
    onSuccess: invalidateAutomations,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      getDesktopWireClient().then((client) => client.automations.renameAutomation({ id, name })),
    onSuccess: invalidateAutomations,
  });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      getDesktopWireClient().then((client) =>
        client.automations.setAutomationEnabled({ id, enabled })
      ),
    onSuccess: invalidateAutomations,
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      getDesktopWireClient().then((client) =>
        client.automations.toggleAutomationEnabled({ id, enabled })
      ),
    onSuccess: invalidateAutomations,
  });

  const runNow = useMutation({
    mutationFn: async (automationId: string) =>
      (await getDesktopWireClient()).automations.runAutomation({ automationId }),
    onSuccess: (_run, id) => invalidateRuns(id),
  });

  const stop = useMutation({
    mutationFn: async (runId: string) =>
      (await getDesktopWireClient()).automations.stopRun({ runId }),
    onSuccess: () => invalidateRuns(),
  });

  const destroy = useMutation({
    mutationFn: async (automationId: string) =>
      (await getDesktopWireClient()).automations.deleteAutomation({ automationId }),
    onSuccess: invalidateAutomations,
  });

  return {
    automations,
    create,
    updateSettings,
    rename,
    setEnabled,
    toggleEnabled,
    runNow,
    stop,
    destroy,
  };
}

export function useAutomationRuns(automationId: string, limit = 20) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, limit],
    queryFn: async () =>
      (await getDesktopWireClient()).automations.listAutomationRuns({
        automationId,
        limit,
        offset: 0,
      }),
    enabled: !!automationId,
  });
}

const PAGINATED_PAGE_SIZE = 25;

export function useScheduledAutomationRun(automationId: string) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, 'scheduled'],
    queryFn: async () =>
      (await getDesktopWireClient()).automations.getNextScheduledRun({ automationId }),
    enabled: !!automationId,
  });
}

type RunStatusFilter = 'done' | 'failed' | 'skipped' | undefined;

export function useAutomationRunsPaginated(
  automationId: string,
  page: number,
  statusFilter?: RunStatusFilter
) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, 'page', page, statusFilter],
    queryFn: async () =>
      (await getDesktopWireClient()).automations.listAutomationRuns({
        automationId,
        limit: PAGINATED_PAGE_SIZE + 1,
        offset: page * PAGINATED_PAGE_SIZE,
        statusFilter,
      }),
    placeholderData: keepPreviousData,
    enabled: !!automationId,
  });
}

export function useAutomationRunCounts(automationId: string) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, 'counts'],
    queryFn: async () =>
      (await getDesktopWireClient()).automations.countAutomationRunsByStatus({ automationId }),
    enabled: !!automationId,
  });
}

export function useLatestAutomationRun(automationId: string) {
  const queryClient = useQueryClient();
  const key = ['automations', 'runs', automationId, 'latest'];

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.automations.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type !== 'run-changed' || event.automationId !== automationId) return;
          queryClient.setQueryData(key, event.run);
        },
        onGap: () => void queryClient.invalidateQueries({ queryKey: key }),
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId, queryClient]);

  return useQuery({
    queryKey: key,
    queryFn: async () => (await getDesktopWireClient()).automations.getLatestRun({ automationId }),
    enabled: !!automationId,
  });
}

export function useAutomationRun(automationId: string, runId: string) {
  const runs = useAutomationRuns(automationId);
  return runs.data?.find((r) => r.id === runId);
}

export function useAutomation(automationId: string, projectId?: string) {
  const { automations } = useAutomations(projectId);
  return automations.data?.find((a) => a.id === automationId);
}

export function useAutomationEventBridge(automationId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.automations.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.automationId !== automationId) return;
          if (event.type === 'automation-changed') {
            void queryClient.invalidateQueries({ queryKey: ['automations'] });
            void queryClient.invalidateQueries({
              queryKey: ['automations', 'runs', event.automationId, 'scheduled'],
            });
          } else {
            void queryClient.invalidateQueries({
              queryKey: ['automations', 'runs', event.automationId],
            });
          }
        },
        onGap: () => void queryClient.invalidateQueries({ queryKey: ['automations'] }),
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [automationId, queryClient]);
}
