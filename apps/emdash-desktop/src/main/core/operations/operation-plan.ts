import type { OperationKind } from '@shared/core/operations/operation-types';

export type OperationStepKind =
  | 'kill-acp-sessions'
  | 'kill-tui-sessions'
  | 'deactivate-workspace'
  | 'teardown-workspace'
  | 'purge-task-rows'
  | 'purge-workspace-row'
  | 'purge-project-row';

export type OperationPlanStep = {
  id: string;
  kind: OperationStepKind;
  label: string;
  destructive: boolean;
};

export type OperationPlan = {
  kind: OperationKind;
  steps: OperationPlanStep[];
};

export type OperationProgress = {
  currentStep?: string;
  completedSteps: number;
  totalSteps: number;
};
