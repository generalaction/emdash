import type { OperationPlanStep } from '../operation-plan';
import type { SessionTargets } from '../session-targets';

export function compileSessionKillSteps(targets: SessionTargets): OperationPlanStep[] {
  const steps: OperationPlanStep[] = [];
  if (targets.acpConversationIds.length > 0) {
    steps.push({
      id: 'kill-acp-sessions',
      kind: 'kill-acp-sessions',
      label: 'Stop ACP sessions',
      destructive: false,
    });
  }
  if (
    targets.tuiConversationIds.length > 0 ||
    targets.terminalSessionIds.length > 0 ||
    targets.tmuxSessionNames.length > 0
  ) {
    steps.push({
      id: 'kill-tui-sessions',
      kind: 'kill-tui-sessions',
      label: 'Stop terminal sessions',
      destructive: false,
    });
  }
  return steps;
}
