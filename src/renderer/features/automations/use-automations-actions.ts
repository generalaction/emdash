import { useCallback } from 'react';
import { firstMountedProjectId } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { formatAutomationError } from '@shared/automations/format';
import { AUTOMATION_NAME_MAX_LENGTH, type Automation } from '@shared/automations/types';
import { useAutomations } from './useAutomations';

function copyAutomationName(name: string) {
  const suffix = ' (copy)';
  const base = name.slice(0, AUTOMATION_NAME_MAX_LENGTH - suffix.length).trimEnd();
  return `${base}${suffix}`;
}

interface UseAutomationsActionsOptions {
  selectedAutomationId: string | null;
  onPanelClose: () => void;
  onRequestCreate: () => void;
}

export function useAutomationsActions({
  selectedAutomationId,
  onPanelClose,
  onRequestCreate,
}: UseAutomationsActionsOptions) {
  const { create, remove, setEnabled, runNow } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');

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

  const requestDelete = useCallback(
    (automation: Automation) => {
      showConfirmDelete({
        title: 'Delete automation',
        description: `“${automation.name}” will be deleted. Run history for this automation will also be removed.`,
        confirmLabel: 'Delete',
        onSuccess: () =>
          remove.mutate(automation.id, {
            onSuccess: () => {
              if (selectedAutomationId === automation.id) onPanelClose();
            },
          }),
      });
    },
    [showConfirmDelete, remove, selectedAutomationId, onPanelClose]
  );

  const requestRunNow = useCallback(
    (automation: Automation) => {
      if (automation.isDraft) return;
      runNow.mutate(automation.id, {
        onError: (error) => {
          toast({
            title: 'Automation failed',
            description: formatAutomationError(error),
            variant: 'destructive',
          });
        },
      });
    },
    [runNow, toast]
  );

  const requestToggleEnabled = useCallback(
    (automation: Automation, enabled: boolean) => {
      if (automation.isDraft) return;
      setEnabled.mutate({ id: automation.id, enabled });
    },
    [setEnabled]
  );

  const requestCopy = useCallback(
    (automation: Automation) => {
      if (!automation.projectId) {
        toast({
          title: 'Cannot copy automation',
          description: 'This automation is not attached to a project.',
          variant: 'destructive',
        });
        return;
      }

      create.mutate(
        {
          name: copyAutomationName(automation.name),
          description: automation.description,
          category: automation.category,
          trigger: automation.trigger,
          actions: automation.actions,
          taskConfig: automation.taskConfig,
          projectId: automation.projectId,
          enabled: automation.enabled,
          isDraft: automation.isDraft,
          builtinTemplateId: automation.builtinTemplateId,
          deadlinePolicy: automation.deadlinePolicy,
          deadlineMs: automation.deadlineMs,
        },
        {
          onSuccess: () => {
            toast({ title: 'Automation copied' });
          },
          onError: (error) => {
            toast({
              title: 'Failed to copy automation',
              description: formatAutomationError(error),
              variant: 'destructive',
            });
          },
        }
      );
    },
    [create, toast]
  );

  const requestBulkDelete = useCallback(
    (automations: ReadonlyArray<Automation>, onDone?: () => void) => {
      if (automations.length === 0) return;
      const count = automations.length;
      showConfirmDelete({
        title: `Delete ${count} automation${count === 1 ? '' : 's'}`,
        description:
          'The selected automations and their run history will be permanently removed. This action cannot be undone.',
        confirmLabel: `Delete ${count} automation${count === 1 ? '' : 's'}`,
        onSuccess: () => {
          for (const automation of automations) {
            remove.mutate(automation.id, {
              onSuccess: () => {
                if (selectedAutomationId === automation.id) onPanelClose();
              },
            });
          }
          onDone?.();
        },
      });
    },
    [showConfirmDelete, remove, selectedAutomationId, onPanelClose]
  );

  const requestBulkSetEnabled = useCallback(
    (automations: ReadonlyArray<Automation>, enabled: boolean, onDone?: () => void) => {
      for (const automation of automations) {
        if (automation.isDraft) continue;
        if (automation.enabled === enabled) continue;
        setEnabled.mutate({ id: automation.id, enabled });
      }
      onDone?.();
    },
    [setEnabled]
  );

  return {
    createPending: create.isPending,
    runNowState: { isPending: runNow.isPending, variables: runNow.variables },
    requestCreate,
    requestDelete,
    requestRunNow,
    requestToggleEnabled,
    requestCopy,
    requestBulkDelete,
    requestBulkSetEnabled,
  };
}
