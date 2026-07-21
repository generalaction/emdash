import type { Result } from '@emdash/shared';
import type { Clock } from '@emdash/shared/scheduling';
import type {
  DeletionEntityKind,
  DeletionMutationError,
  OperationKind,
  OperationPayload,
  OperationStatus,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';

export type OperationConfirmationReason = 'stale' | 'workspace-modified' | 'reconciler-proposed';

export type OperationProgress = {
  currentStep?: string;
  completedSteps: number;
  totalSteps: number;
};

export type OperationDescription = {
  entityName?: string;
  workspacePath?: string;
  branchName?: string;
};

export type OperationRunError =
  | {
      type: 'awaiting-confirmation';
      reason: OperationConfirmationReason;
    }
  | {
      type: 'failed';
      code: string;
      message: string;
      retryable: boolean;
    };

export type OperationRunContext = {
  operation: LifecycleOperationRow;
  db: AppDb;
  signal: AbortSignal;
  clock: Clock;
  reportProgress(progress: OperationProgress): void;
};

export type OperationDraft = Pick<
  LifecycleOperationRow,
  | 'id'
  | 'kind'
  | 'status'
  | 'projectId'
  | 'taskId'
  | 'workspaceId'
  | 'entityKey'
  | 'hostRef'
  | 'payload'
  | 'createdAt'
>;

export type OperationDraftInput = Pick<
  OperationDraft,
  'kind' | 'entityKey' | 'hostRef' | 'payload'
> &
  Partial<
    Pick<OperationDraft, 'id' | 'status' | 'projectId' | 'taskId' | 'workspaceId' | 'createdAt'>
  >;

export type OperationInsertOptions = {
  dedupeStatuses?: readonly OperationStatus[];
  precondition?: (tx: DrizzleTx) => DeletionMutationError | undefined;
  tombstone?: (tx: DrizzleTx) => number;
};

export type OperationRelatedInsert = {
  draft: OperationDraftInput;
  options?: OperationInsertOptions;
};

export type OperationSubmission =
  | {
      outcome: 'enqueue';
      draft: OperationDraftInput;
      options?: OperationInsertOptions;
      related?: OperationRelatedInsert[];
    }
  | {
      outcome: 'existing';
      operationId?: string;
    };

export type OperationSubmitContext = {
  db: AppDb;
  clock: Clock;
};

export type OperationSubmit = (
  prepare: (
    context: OperationSubmitContext
  ) => Promise<Result<OperationSubmission, DeletionMutationError>>
) => Promise<Result<{ operationId?: string }, DeletionMutationError>>;

export type OperationReconcileContext = {
  db: AppDb;
  clock: Clock;
  submit: OperationSubmit;
};

export type OperationForgetContext = {
  operation: LifecycleOperationRow;
  db: AppDb;
  clock: Clock;
  markAbandoned(tx: DrizzleTx, operation?: LifecycleOperationRow): void;
};

export type OperationRetryContext = {
  operation: LifecycleOperationRow;
  db: AppDb;
  clock: Clock;
  reset(tx: DrizzleTx, operation?: LifecycleOperationRow): void;
};

export type OperationReadyContext = {
  operation: LifecycleOperationRow;
  db: AppDb;
};

export type OperationDescribeContext = {
  operation: LifecycleOperationRow;
  db: AppDb;
};

export type OperationDefinition = {
  kind: OperationKind;
  entityKind: DeletionEntityKind;
  run(context: OperationRunContext): Promise<Result<void, OperationRunError>>;
  describe(context: OperationDescribeContext): Promise<OperationDescription>;
  isReady?(context: OperationReadyContext): Promise<boolean>;
  forget?(context: OperationForgetContext): Promise<void>;
  retry?(context: OperationRetryContext): Promise<void>;
  reconcile?(context: OperationReconcileContext): Promise<void>;
};

export type OperationsSshManager = {
  on(eventName: 'connection-event', listener: (event: { type: string }) => void): unknown;
  off(eventName: 'connection-event', listener: (event: { type: string }) => void): unknown;
  isConnected(connectionId: string): boolean;
};

export type PendingCleanupNotification = {
  operationId: string;
  payload: OperationPayload;
  hostRef: string;
  reason: OperationConfirmationReason;
};

export type OperationsNotificationPublisher = {
  publishPendingCleanup(notification: PendingCleanupNotification): void;
};
