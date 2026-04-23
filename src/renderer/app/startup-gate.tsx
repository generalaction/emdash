import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type {
  StartupDataGateAction,
  StartupDataGateScenario,
  StartupDataGateState,
} from '@shared/startup-data-gate';
import { ISSUE_CONNECTION_STATUS_QUERY_KEY } from '@renderer/features/integrations/integrations-provider';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';
import { StartupGateModal, type StartupGateModalPhase } from './startup-gate-modal';

const STARTUP_DATA_GATE_QUERY_KEY = ['startup-data-gate'] as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function StartupGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const projectsLoadedRef = useRef(false);

  const gateStateQuery = useQuery({
    queryKey: STARTUP_DATA_GATE_QUERY_KEY,
    queryFn: () => rpc.startupDataGate.getState(),
    staleTime: Infinity,
    retry: false,
  });

  const actionMutation = useMutation({
    mutationFn: (action: StartupDataGateAction) => rpc.startupDataGate.resolveAction({ action }),
    onSuccess: (result) => {
      queryClient.setQueryData(STARTUP_DATA_GATE_QUERY_KEY, result.state);
      if (!result.success) return;

      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['github:status'] });
      void queryClient.invalidateQueries({ queryKey: ['account:session'] });
    },
  });

  const gateState = gateStateQuery.data as StartupDataGateState | undefined;
  const scenario: StartupDataGateScenario = gateState?.scenario ?? 'none';

  const phase: StartupGateModalPhase | 'ready' = (() => {
    if (gateStateQuery.isPending) return 'checking';
    if (actionMutation.isPending) return 'running';
    if (!gateState) return 'ready';
    if (gateState.phase === 'running') return 'running';
    if (gateState.phase === 'needs_decision') return 'needs-decision';
    return 'ready';
  })();

  const errorMessage =
    (actionMutation.data && !actionMutation.data.success ? actionMutation.data.error : null) ??
    (actionMutation.isError ? getErrorMessage(actionMutation.error) : null);

  useEffect(() => {
    if (phase !== 'ready' || projectsLoadedRef.current) return;

    projectsLoadedRef.current = true;
    appState.projects.load().catch((error) => {
      log.error('startup-gate: failed to load projects after gate', error);
    });
  }, [phase]);

  const handleSelectAction = useCallback(
    (action: StartupDataGateAction) => {
      if (phase !== 'needs-decision') return;
      actionMutation.mutate(action);
    },
    [actionMutation, phase]
  );

  if (phase === 'ready') {
    if (gateStateQuery.isError) {
      log.error('startup-gate: failed to load gate state; bypassing gate', gateStateQuery.error);
    }
    return <>{children}</>;
  }

  return (
    <StartupGateModal
      phase={phase}
      scenario={scenario}
      error={errorMessage}
      onSelectAction={handleSelectAction}
    />
  );
}
