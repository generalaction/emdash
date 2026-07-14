import type { WorkspaceError, WorkspaceOperationStage } from '@emdash/core/runtimes/workspace/api';
import {
  SteppedLoaderProgress,
  type SteppedLoaderProps,
  type StepStatus,
} from '@emdash/ui/react/components';
import { createElement, type ReactNode } from 'react';
import type {
  WorkspaceBootstrapProgress,
  WorkspaceBootstrapStep,
} from '@shared/core/workspaces/wire-contract';

export type BootstrapSteppedLoaderModel = Pick<
  SteppedLoaderProps,
  'steps' | 'activeStepId' | 'status'
> & {
  activeChildren?: ReactNode;
  message: string;
};

const STEP_LABELS: Record<WorkspaceBootstrapStep, string> = {
  'resolving-worktree': 'Creating worktree',
  'initialising-workspace': 'Activating workspace',
  'running-provision-script': 'Running setup script',
  connecting: 'Connecting workspace',
  'setting-up-workspace': 'Setting up workspace',
  'starting-sessions': 'Preparing task',
};

export function bootstrapProgressToSteppedLoader(
  progress?: WorkspaceBootstrapProgress | null,
  error?: WorkspaceError | null
): BootstrapSteppedLoaderModel {
  if (progress?.operation) {
    return operationProgressToSteppedLoader(progress, error);
  }

  const stepId = progress?.step ?? error?.stageId ?? 'workspace-setup';
  const stepName = progress ? STEP_LABELS[progress.step] : 'Setting up workspace';
  const status: StepStatus = error ? 'error' : progress ? 'loading' : 'pending';
  const message = error?.message ?? progress?.message ?? stepName;

  return {
    steps: [{ id: stepId, name: stepName }],
    activeStepId: stepId,
    status,
    message,
  };
}

function operationProgressToSteppedLoader(
  progress: WorkspaceBootstrapProgress,
  error?: WorkspaceError | null
): BootstrapSteppedLoaderModel {
  const stages = progress.operation?.stages.filter((stage) => stage.status !== 'skipped') ?? [];
  const activeStage =
    (error?.stageId ? stages.find((stage) => stage.id === error.stageId) : undefined) ??
    stages.find((stage) => stage.status === 'running') ??
    stages.find((stage) => stage.status === 'failed') ??
    stages.find((stage) => stage.status === 'pending') ??
    stages.at(-1);

  if (!activeStage) {
    return bootstrapProgressToSteppedLoader(
      { step: progress.step, message: progress.message },
      error
    );
  }

  const activeChildren = progressForStage(activeStage);
  const activeStepId = activeStage.id;
  const status = statusForStage(activeStage, error);
  const message = error?.message ?? activeStage.progress?.message ?? progress.message;

  return {
    steps: stages.map((stage) => ({
      id: stage.id,
      name: stage.label,
      children: stage.id === activeStepId ? activeChildren : undefined,
    })),
    activeStepId,
    status,
    activeChildren,
    message,
  };
}

function statusForStage(stage: WorkspaceOperationStage, error?: WorkspaceError | null): StepStatus {
  if (stage.status === 'failed' || error?.stageId === stage.id) {
    return 'error';
  }

  if (error && !error.stageId) {
    return 'error';
  }

  if (stage.status === 'running') {
    return 'loading';
  }

  return 'pending';
}

function progressForStage(stage: WorkspaceOperationStage): ReactNode {
  const percent = stage.progress?.percent;
  if (percent == null) {
    return undefined;
  }

  const roundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  return createElement(SteppedLoaderProgress, {
    percent: roundedPercent,
    leftLabel: stage.progress?.message ?? stage.label,
    rightLabel: `${roundedPercent}%`,
    'aria-label': stage.label,
  });
}
