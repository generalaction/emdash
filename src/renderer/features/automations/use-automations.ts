import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type {
  CreateAutomationParams,
  UpdateAutomationSettingsPatch,
} from '@shared/automations/automation';

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
    queryFn: () => rpc.automations.listAutomations(projectId),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (params: CreateAutomationParams) => rpc.automations.createAutomation(params),
    onSuccess: invalidateAutomations,
  });

  const updateSettings = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationSettingsPatch }) =>
      rpc.automations.updateAutomationSettings(id, patch),
    onSuccess: invalidateAutomations,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      rpc.automations.renameAutomation(id, name),
    onSuccess: invalidateAutomations,
  });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpc.automations.setAutomationEnabled(id, enabled),
    onSuccess: invalidateAutomations,
  });

  const runNow = useMutation({
    mutationFn: (id: string) => rpc.automations.runAutomation(id),
    onSuccess: (_run, id) => invalidateRuns(id),
  });

  const stop = useMutation({
    mutationFn: (runId: string) => rpc.automations.stopRun(runId),
    onSuccess: () => invalidateRuns(),
  });

  const destroy = useMutation({
    mutationFn: (id: string) => rpc.automations.deleteAutomation(id),
    onSuccess: invalidateAutomations,
  });

  return { automations, create, updateSettings, rename, setEnabled, runNow, stop, destroy };
}

export function useAutomationRuns(automationId: string, limit = 20) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, limit],
    queryFn: () => rpc.automations.listAutomationRuns(automationId, limit, 0),
    enabled: !!automationId,
  });
}

const PAGINATED_PAGE_SIZE = 25;

export function useScheduledAutomationRun(automationId: string) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, 'scheduled'],
    queryFn: () => rpc.automations.getNextScheduledRun(automationId),
    enabled: !!automationId,
  });
}

export function useAutomationRunsPaginated(automationId: string, page: number) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, 'page', page],
    queryFn: () =>
      rpc.automations.listAutomationRuns(
        automationId,
        PAGINATED_PAGE_SIZE + 1,
        page * PAGINATED_PAGE_SIZE
      ),
    placeholderData: keepPreviousData,
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
