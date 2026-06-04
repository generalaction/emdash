import { useCallback } from 'react';
import { firstMountedProjectId } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { AUTOMATION_NAME_MAX_LENGTH } from '@shared/automations/automation-run';
import { useAutomations } from './use-automations';

function copyAutomationName(name: string) {
  const suffix = ' (copy)';
  const base = name.slice(0, AUTOMATION_NAME_MAX_LENGTH - suffix.length).trimEnd();
  return `${base}${suffix}`;
}

// Suppress unused warning — will be used when copy is re-enabled
void copyAutomationName;

interface UseAutomationsActionsOptions {
  selectedAutomationId: string | null;
  onPanelClose: () => void;
  onRequestCreate: () => void;
}

export function useAutomationsActions({ onRequestCreate }: UseAutomationsActionsOptions) {
  const { create } = useAutomations();
  const { toast } = useToast();

  const requestCreate = useCallback(() => {
    if (!firstMountedProjectId()) {
      toast({
        title: 'No project available',
        description: 'Add or mount a project before creating an automation.',
        variant: 'destructive',
      });
      return;
    }
    onRequestCreate();
  }, [onRequestCreate, toast]);

  return {
    createPending: create.isPending,
    runNowState: { isPending: false, variables: undefined },
    requestCreate,
    requestDelete: undefined,
    requestRunNow: undefined,
    requestToggleEnabled: undefined,
    requestCopy: undefined,
    requestBulkDelete: undefined,
    requestBulkSetEnabled: undefined,
  };
}
