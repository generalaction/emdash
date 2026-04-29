import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  Automation,
  AutomationRun,
  BuiltinAutomationTemplate,
  CreateAutomationInput,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import { rpc } from '@renderer/lib/ipc';

const automationsKey = (projectId?: string) => ['automations', projectId ?? 'all'] as const;
const catalogKey = ['automations', 'catalog'] as const;
const runsKey = (automationId: string) => ['automations', 'runs', automationId] as const;

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
    queryKey: runsKey(automationId),
    queryFn: () => unwrap<AutomationRun[]>(rpc.automations.listRuns(automationId, limit)),
  });
}
