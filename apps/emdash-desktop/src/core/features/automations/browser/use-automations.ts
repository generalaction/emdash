import type { Result } from '@emdash/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type {
  AutomationAdoptionError,
  AutomationDefinitionError,
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
    mutationFn: async (params: CreateAutomationParams) => {
      const result = await (await getDesktopWireClient()).automations.create(params);
      return unwrapAutomationResult(result);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateAutomationPatch }) => {
      const result = await (await getDesktopWireClient()).automations.update({ id, patch });
      return unwrapAutomationResult(result);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (automationId: string) => {
      const result = await (await getDesktopWireClient()).automations.delete({ automationId });
      return unwrapAutomationResult(result);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY }),
  });
}

export function useRunAutomationNow() {
  return useMutation({
    mutationFn: async ({
      projectId,
      automationId,
    }: {
      projectId: string;
      automationId: string;
    }) => {
      const result = await (
        await getDesktopWireClient()
      ).automations.startRun({ projectId, automationId });
      if (!result.success) throw new Error(result.error.message);
      return result.data.run;
    },
  });
}

export function useStopAutomationRun() {
  return useMutation({
    mutationFn: async ({
      projectId,
      automationId,
      runId,
    }: {
      projectId: string;
      automationId: string;
      runId: string;
    }) => {
      const result = await (
        await getDesktopWireClient()
      ).automations.cancelRun({
        projectId,
        automationId,
        runId,
      });
      if (!result.success) throw new Error(result.error.message);
    },
  });
}

export function useAdoptAutomationRun() {
  return useMutation({
    mutationFn: async ({ automationId, runId }: { automationId: string; runId: string }) => {
      const result = await (
        await getDesktopWireClient()
      ).automations.adoptRun({ automationId, runId });
      return unwrapAutomationResult(result);
    },
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

export function useAutomationRun(projectId: string, automationId: string, runId: string) {
  const store = useRunStore(projectId, automationId, true);
  return store.run(runId);
}

export function useLatestAutomationRun(projectId: string, automationId: string, enabled = true) {
  const store = useRunStore(projectId, automationId, enabled);
  return {
    data: enabled ? store.latestRun : null,
    isPending: enabled && store.overviewState.loading,
    error: store.overviewState.error,
  };
}

export function useScheduledAutomationRun(projectId: string, automationId: string, enabled = true) {
  const store = useRunStore(projectId, automationId, enabled);
  return {
    data: enabled ? store.nextScheduledRun : null,
    isPending: enabled && store.overviewState.loading,
    error: store.overviewState.error,
  };
}

export function useAutomationRunCounts(projectId: string, automationId: string, enabled = true) {
  const store = useRunStore(projectId, automationId, enabled);
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
  projectId: string,
  automationId: string,
  filter: RunHistoryFilter,
  limit: number,
  enabled = true
) {
  const store = useRunStore(projectId, automationId, enabled);
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

function useRunStore(projectId: string, automationId: string, enabled: boolean) {
  const store = getAutomationRunStore(projectId, automationId);
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  useEffect(() => {
    if (!enabled) return;
    return store.acquire();
  }, [enabled, store]);
  return store;
}

function unwrapAutomationResult<T>(
  result: Result<T, AutomationDefinitionError | AutomationAdoptionError>
): T {
  if (!result.success) throw new Error(result.error.message, { cause: result.error });
  return result.data;
}
