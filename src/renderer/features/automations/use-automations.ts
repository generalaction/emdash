import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { CreateAutomationParams, UpdateAutomationPatch } from '@shared/automations/automation';

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

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationPatch }) =>
      rpc.automations.updateAutomation(id, patch),
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

  return { automations, create, update, setEnabled, runNow, stop, destroy };
}

export function useAutomationRuns(automationId: string, limit = 20) {
  return useQuery({
    queryKey: ['automations', 'runs', automationId, limit],
    queryFn: () => rpc.automations.listAutomationRuns(automationId, limit, 0),
    enabled: !!automationId,
  });
}

