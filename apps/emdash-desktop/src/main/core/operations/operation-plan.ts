import type { OperationKind } from '@core/primitives/operations/api';

export type OperationStepKind =
  | 'kill-acp-sessions'
  | 'kill-tui-sessions'
  | 'deactivate-workspace'
  | 'clean-artifacts'
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

export type OperationStepErrorCode = 'workspace-in-use' | 'step-failed' | 'step-timeout';

export type OperationStepError = {
  code: OperationStepErrorCode;
  message: string;
};

export type ExecutableOperationPlan = {
  kind: OperationKind;
  steps: OperationPlanStep[];
  preconditionFailure?: never;
};

export type BlockedOperationPlan = {
  kind: OperationKind;
  steps?: never;
  preconditionFailure: {
    type: Extract<OperationStepErrorCode, 'workspace-in-use'>;
    message: string;
  };
};

export type OperationPlan = ExecutableOperationPlan | BlockedOperationPlan;

export type OperationProgress = {
  currentStep?: string;
  completedSteps: number;
  totalSteps: number;
};
