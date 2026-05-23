import { useCallback, useMemo, useState } from 'react';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import type { Automation } from '@shared/automations/types';

export type AutomationsPanelState =
  | { kind: 'create' }
  | { kind: 'edit'; automation: Automation }
  | null;

export interface UseAutomationsPanel {
  panel: AutomationsPanelState;
  selectedAutomationId: string | null;
  isOpen: boolean;
  openEdit: (automation: Automation) => void;
  openCreate: () => void;
  close: () => void;
  setEdited: (automation: Automation) => void;
}

export function useAutomationsPanel(automations: readonly Automation[]): UseAutomationsPanel {
  const { params, setParams } = useParams('automations');
  const [local, setLocal] = useState<AutomationsPanelState>(null);

  const requestedId = params.selectedAutomationId;
  const panel: AutomationsPanelState = useMemo(() => {
    if (local) return local;
    if (!requestedId) return null;
    const target = automations.find((automation) => automation.id === requestedId);
    return target ? { kind: 'edit', automation: target } : null;
  }, [local, requestedId, automations]);

  const clearRequestedParam = useCallback(() => {
    if (requestedId) setParams({ selectedAutomationId: undefined });
  }, [requestedId, setParams]);

  const close = useCallback(() => {
    setLocal(null);
    clearRequestedParam();
  }, [clearRequestedParam]);

  const openEdit = useCallback(
    (automation: Automation) => {
      clearRequestedParam();
      setLocal({ kind: 'edit', automation });
    },
    [clearRequestedParam]
  );

  const openCreate = useCallback(() => {
    clearRequestedParam();
    setLocal({ kind: 'create' });
  }, [clearRequestedParam]);

  const setEdited = useCallback(
    (automation: Automation) => {
      clearRequestedParam();
      setLocal({ kind: 'edit', automation });
    },
    [clearRequestedParam]
  );

  return {
    panel,
    selectedAutomationId: panel?.kind === 'edit' ? panel.automation.id : null,
    isOpen: panel !== null,
    openEdit,
    openCreate,
    close,
    setEdited,
  };
}
