import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type {
  CreateAutomationParams,
  UpdateAutomationPatch,
} from '@core/primitives/automations/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { getAutomationRunStore, type RunHistoryFilter } from './automation-run-store';

const AUTOMATIONS_QUERY_KEY = ['automations'] as const;

export function useAutomations(projectId?: string) {
  return useQuery({
    queryKey: [...AUTOMATIONS_QUERY_KEY, projectId],
    queryFn: async () => (await getDesktopWireClient()).automations.list({ projectId }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateAutomationParams) =>
      (await getDesktopWireClient()).automations.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationPatch }) =>
      getDesktopWireClient().then((client) => client.automations.update({ id, patch })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (automationId: string) =>
      (await getDesktopWireClient()).automations.delete({ automationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useRunAutomationNow() {
  return useMutation({
    mutationFn: async (automationId: string) => {
      const result = await (await getDesktopWireClient()).automations.startRun({ automationId });
      if (!result.success) throw new Error(result.error.message);
      return result.data.run;
    },
  });
}

export function useStopAutomationRun() {
  return useMutation({
    mutationFn: async ({ automationId, runId }: { automationId: string; runId: string }) => {
      const result = await (
        await getDesktopWireClient()
      ).automations.cancelRun({
        automationId,
        runId,
      });
      if (!result.success) throw new Error(result.error.message);
    },
  });
}

export function useAdoptAutomationRun() {
  return useMutation({
    mutationFn: ({ automationId, runId }: { automationId: string; runId: string }) =>
      getDesktopWireClient().then((client) => client.automations.adoptRun({ automationId, runId })),
  });
}

export function useAutomationTargetAvailability(projectId?: string) {
  return useQuery({
    queryKey: [...AUTOMATIONS_QUERY_KEY, 'target-availability', projectId],
    queryFn: async () =>
      (await getDesktopWireClient()).automations.getTargetAvailability({ projectId }),
  });
}

export function useAutomation(automationId: string, projectId?: string) {
  return useAutomations(projectId).data?.find((automation) => automation.id === automationId);
}

export function useAutomationRun(automationId: string, runId: string) {
  const store = useRunStore(automationId, true);
  return store.run(runId);
}

export function useLatestAutomationRun(automationId: string, enabled = true) {
  const store = useRunStore(automationId, enabled);
  return {
    data: enabled ? store.latestRun : null,
    isPending: enabled && store.overviewState.loading,
    error: store.overviewState.error,
  };
}

export function useScheduledAutomationRun(automationId: string, enabled = true) {
  const store = useRunStore(automationId, enabled);
  return {
    data: enabled ? store.nextScheduledRun : null,
    isPending: enabled && store.overviewState.loading,
    error: store.overviewState.error,
  };
}

export function useAutomationRunCounts(automationId: string, enabled = true) {
  const store = useRunStore(automationId, enabled);
  const counts = store.counts;
  return {
    data: {
      all: counts.done + counts.failed + counts.skipped + counts.cancelled,
      done: counts.done,
      failed: counts.failed,
      skipped: counts.skipped,
      cancelled: counts.cancelled,
    },
    isPending: enabled && store.overviewState.loading,
    error: store.overviewState.error,
  };
}

export function useAutomationRunHistory(
  automationId: string,
  filter: RunHistoryFilter,
  limit: number,
  enabled = true
) {
  const store = useRunStore(automationId, enabled);
  useEffect(() => {
    if (enabled) void store.loadInitialHistory(filter, limit);
  }, [enabled, filter, limit, store]);
  const state = store.historyState(filter);
  return {
    data: enabled ? store.history(filter) : [],
    isPending: enabled && state.loading && !state.loaded,
    isLoadingMore: enabled && state.loading && state.loaded,
    hasMore: enabled && state.hasMore,
    error: state.error,
    loadMore: () => store.loadMoreHistory(filter, limit),
  };
}

function useRunStore(automationId: string, enabled: boolean) {
  const store = getAutomationRunStore(automationId);
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  useEffect(() => {
    if (!enabled) return;
    return store.acquire();
  }, [enabled, store]);
  return store;
}
