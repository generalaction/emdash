import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type {
  Automation,
  AutomationRun,
  AutomationRunWithContext,
  BuiltinAutomationTemplate,
  CreateAutomationInput,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import { rpc } from '@renderer/lib/ipc';

const automationsKey = (projectId?: string) => ['automations', projectId ?? 'all'] as const;
const catalogKey = ['automations', 'catalog'] as const;
const runsKey = (automationId: string, limit: number) =>
  ['automations', 'runs', automationId, limit] as const;
const recentRunsKey = (projectId: string | undefined, limit: number) =>
  ['automations', 'recent-runs', projectId ?? 'all', limit] as const;

async function unwrap<T>(
  promise: Promise<{ success: true; data: T } | { success: false; error: string }>
) {
  const result = await promise;
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export function useAutomations(projectId?: string) {
  const automations = useQuery({
    queryKey: automationsKey(projectId),
    queryFn: () => unwrap<Automation[]>(rpc.automations.list(projectId)),
  });

  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => unwrap<BuiltinAutomationTemplate[]>(rpc.automations.getCatalog()),
  });

  const create = useMutation({
    mutationFn: (input: CreateAutomationInput) => unwrap<Automation>(rpc.automations.create(input)),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationPatch }) =>
      unwrap<Automation>(rpc.automations.update(id, patch)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(rpc.automations.remove(id)),
  });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap<Automation>(rpc.automations.setEnabled(id, enabled)),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => unwrap<AutomationRun>(rpc.automations.runNow(id)),
  });

  return {
    automations,
    catalog,
    create,
    update,
    remove,
    setEnabled,
    runNow,
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
