import {
  useAdoptAutomationRun,
  useAutomationTargetAvailability,
  useStopAutomationRun,
} from './use-automations';

export function useAutomationRunActions(automationId: string, projectId: string | null) {
  const adopt = useAdoptAutomationRun();
  const stop = useStopAutomationRun();
  const availability = useAutomationTargetAvailability(projectId ?? undefined);
  return {
    stopRun: (runId: string) => {
      if (!projectId) return;
      stop.mutate({ projectId, automationId, runId });
    },
    adoptRun: (runId: string) => adopt.mutateAsync({ automationId, runId }),
    isAdopting: adopt.isPending,
    runtimeAvailable: availability.data?.available === true,
  };
}
