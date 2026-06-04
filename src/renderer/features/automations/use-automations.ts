import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { CreateAutomationParams } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';

export function useAutomations(projectId?: string) {
  const queryClient = useQueryClient();

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ queryKey: ['automations'] });
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

  return { automations, create };
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
