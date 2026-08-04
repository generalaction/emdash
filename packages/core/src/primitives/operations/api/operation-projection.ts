import {
  displayStatus,
  isTerminalStatus,
  operationTreeView,
  type DispatchPassReport,
  type OperationProgress,
  type OperationRecord,
  type OperationTreeNode,
} from '@primitives/kernel/api';
import {
  operationNeedsConfirmationErrorSchema,
  type OperationDisplayState,
  type OperationEntityKind,
  type OperationPrediction,
} from './operation-state';
import { rollupStatus, type OperationTree, type OperationTreeList } from './operation-tree';

export type ParsedOperationProjection = {
  displayName: string;
  entityKind: OperationEntityKind;
  projectId?: string;
  entityName?: string;
  hostRef: string;
  hostLabel?: string;
  workspacePath?: string;
  branchName?: string;
  prediction?: OperationPrediction;
};

export type OperationProjectionInput = {
  records: readonly OperationRecord[];
  parsedInputs: ReadonlyMap<string, ParsedOperationProjection>;
  progress: ReadonlyMap<string, OperationProgress>;
  dispatchReport?: DispatchPassReport;
  now: number;
  recentSettledWindowMs: number;
  projectId?: string;
  fallbackHostRef: string;
};

export function projectOperationTrees(input: OperationProjectionInput): OperationTreeList {
  const records = input.records.filter((record) => {
    if (
      isTerminalStatus(record.status) &&
      record.status !== 'failed' &&
      record.status !== 'rejected' &&
      record.updatedAt < input.now - input.recentSettledWindowMs
    ) {
      return false;
    }
    const parsed = input.parsedInputs.get(record.id);
    return input.projectId === undefined || parsed?.projectId === input.projectId;
  });
  const nodes = operationTreeView(records).filter(retainTree);
  return Object.fromEntries(
    nodes.map((node) => {
      const root = projectOperationDisplay(node.record, input);
      const children = flattenTreeChildren(node).map((record) =>
        projectOperationDisplay(record, input)
      );
      const allNodes = [root, ...children];
      const tree: OperationTree = {
        root,
        children,
        rollup: {
          total: allNodes.length,
          done: allNodes.filter((item) => item.status === 'succeeded').length,
          status: rollupStatus(allNodes),
        },
      };
      return [root.operationId, tree];
    })
  );
}

export function projectOperationDisplay(
  record: OperationRecord,
  input: Pick<
    OperationProjectionInput,
    'parsedInputs' | 'progress' | 'dispatchReport' | 'fallbackHostRef'
  >
): OperationDisplayState {
  const parsed = input.parsedInputs.get(record.id);
  const progress = input.progress.get(record.id);
  const stages = progress?.stages.map(toDisplayStage);
  const current = progress?.stages.at(-1);
  const base = {
    operationId: record.id,
    operationKind: record.name,
    displayName: parsed?.displayName ?? record.name,
    entityId: record.key,
    entityKind: parsed?.entityKind ?? ('project' as const),
    projectId: parsed?.projectId,
    entityName: parsed?.entityName,
    hostRef: parsed?.hostRef ?? input.fallbackHostRef,
    hostLabel: parsed?.hostLabel,
    workspacePath: parsed?.workspacePath,
    branchName: parsed?.branchName,
    createdAt: record.createdAt,
    attempt: record.attempt,
    currentStep: current?.id,
    completedSteps: progress?.stages.filter((stage) => stage.status === 'succeeded').length,
    totalSteps: progress?.stages.length,
    error: record.error?.message,
  };
  const confirmation = operationNeedsConfirmationErrorSchema.safeParse(record.rejectedError);
  if (record.status === 'rejected' && confirmation.success) {
    return {
      ...base,
      status: 'awaiting-confirmation',
      confirmationReason: confirmation.data.reason,
      error: confirmation.data.message,
    };
  }
  const status = displayStatus(record, input.dispatchReport);
  if (status.kind === 'deferred' && status.reason === 'gated') {
    return { ...base, status: 'blocked-host-offline', prediction: parsed?.prediction };
  }
  if (status.kind === 'waiting') {
    return { ...base, status: 'waiting', prediction: parsed?.prediction };
  }
  if (status.kind === 'running') return { ...base, status: 'running', stages };
  if (status.kind === 'waiting-children') return { ...base, status: 'waiting-children' };
  if (status.kind === 'succeeded') return { ...base, status: 'succeeded' };
  if (status.kind === 'failed' || status.kind === 'rejected') {
    return {
      ...base,
      status: 'failed',
      error: base.error ?? 'Operation failed',
      stages,
    };
  }
  return { ...base, status: 'queued', prediction: parsed?.prediction };
}

export function projectOperationStages(
  record: OperationRecord,
  progress?: OperationProgress
): OperationProgress['stages'] {
  if (progress) return progress.stages.map(toDisplayStage);
  const outcome = record.outcome;
  if (!outcome) return [];
  const stages: OperationProgress['stages'] = outcome.completedStages.map((id) => ({
    id,
    label: id,
    status: 'succeeded',
  }));
  if (outcome.failedStage) {
    stages.push({
      id: outcome.failedStage,
      label: outcome.failedStage,
      status: 'failed',
      ...(record.error ? { error: { message: record.error.message } } : {}),
    });
  }
  return stages;
}

function toDisplayStage(
  stage: OperationProgress['stages'][number]
): OperationProgress['stages'][number] {
  return {
    id: stage.id,
    label: stage.label,
    status: stage.status,
    progress: stage.progress,
    error: stage.error,
    substages: stage.substages?.map(toDisplayStage),
  };
}

function retainTree(node: OperationTreeNode): boolean {
  return flattenTreeRecords(node).some(
    (record) =>
      !isTerminalStatus(record.status) || record.status === 'failed' || record.status === 'rejected'
  );
}

function flattenTreeRecords(node: OperationTreeNode): OperationRecord[] {
  return [node.record, ...node.children.flatMap(flattenTreeRecords)];
}

function flattenTreeChildren(node: OperationTreeNode): OperationRecord[] {
  return node.children.flatMap(flattenTreeRecords);
}
