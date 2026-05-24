import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type {
  Automation,
  AutomationRun,
  AutomationRunWithContext,
  CreateAutomationInput,
  UpdateAutomationPatch,
} from '@shared/automations/types';

const automationsKey = (projectId?: string) => ['automations', projectId ?? 'all'] as const;
const runsKey = (automationId: string, limit: number) =>
  ['automations', 'runs', automationId, limit] as const;
const recentRunsKey = (projectId: string | undefined, limit: number) =>
  ['automations', 'recent-runs', projectId ?? 'all', limit] as const;

function isAutomationQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'automations' && queryKey[1] !== 'catalog';
}

async function unwrap<T>(
  promise: Promise<{ success: true; data: T } | { success: false; error: string }>
) {
  const result = await promise;
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export function useAutomations(projectId?: string) {
  const queryClient = useQueryClient();

  function invalidateAutomations() {
    void queryClient.invalidateQueries({ predicate: (query) => isAutomationQuery(query.queryKey) });
  }

  const automations = useQuery({
    queryKey: automationsKey(projectId),
    queryFn: () => unwrap<Automation[]>(rpc.automations.list(projectId)),
  });

  const create = useMutation({
    mutationFn: (input: CreateAutomationInput) => unwrap<Automation>(rpc.automations.create(input)),
    onSuccess: invalidateAutomations,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationPatch }) =>
      unwrap<Automation>(rpc.automations.update(id, patch)),
    onSuccess: invalidateAutomations,
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(rpc.automations.remove(id)),
    onSuccess: invalidateAutomations,
  });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap<Automation>(rpc.automations.setEnabled(id, enabled)),
    onSuccess: invalidateAutomations,
  });

  const setProject = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      unwrap<Automation>(rpc.automations.setProject(id, projectId)),
    onSuccess: invalidateAutomations,
  });

  const runNow = useMutation({
    mutationFn: (id: string) => unwrap<AutomationRun>(rpc.automations.runNow(id)),
    onSuccess: invalidateAutomations,
  });

  const removeRun = useMutation({
    mutationFn: (runId: string) => unwrap<void>(rpc.automations.removeRun(runId)),
    onSuccess: invalidateAutomations,
  });

  return {
    automations,
    create,
    update,
    remove,
    setEnabled,
    setProject,
    runNow,
    removeRun,
  };
}

export function useAutomationRuns(automationId: string, limit = 20) {
  return useQuery({
    queryKey: runsKey(automationId, limit),
    queryFn: () => unwrap<AutomationRun[]>(rpc.automations.listRuns(automationId, limit)),
    placeholderData: keepPreviousData,
  });
}

export function useRecentAutomationRuns(projectId?: string, limit = 50) {
  return useQuery({
    queryKey: recentRunsKey(projectId, limit),
    queryFn: () =>
      unwrap<AutomationRunWithContext[]>(rpc.automations.listRecentRuns(projectId, limit)),
    placeholderData: keepPreviousData,
  });
}
