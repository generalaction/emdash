import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { CreateAutomationParams, UpdateAutomationPatch } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';

export function useAutomations(projectId?: string) {
  const queryClient = useQueryClient();

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
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

  return { automations, create, update, setEnabled };
}

export function useAutomationRuns(_automationId: string, _limit = 20) {
  return useQuery({
    queryKey: ['automations', 'runs', _automationId, _limit],
    queryFn: (): AutomationRun[] => [],
    enabled: false,
  });
}

export function useAutomationRunById(_runId: string | undefined) {
  return useQuery({
    queryKey: ['automations', 'run', _runId],
    queryFn: (): AutomationRun | null => null,
    enabled: false,
  });
}
