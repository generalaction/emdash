import type {
  AnyOperationDefinition,
  ConflictPolicy,
  InputOf,
  OperationHandler,
  OperationRecord,
  ResourceClaim,
} from '@emdash/core/primitives/kernel/api';
import type {
  OperationConfirmationReason,
  OperationEntityKind,
  OperationMutationError,
} from '@emdash/core/primitives/operations/api';
import type { Clock } from '@emdash/shared/scheduling';
import type { OperationKind, OperationPayload } from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';

export type OperationProgress = {
  currentStep?: string;
  completedSteps: number;
  totalSteps: number;
  waiting?: boolean;
};

export type OperationDescription = {
  entityName?: string;
  hostLabel?: string;
  workspacePath?: string;
  branchName?: string;
};

export type OperationInputSource = 'user' | 'reconciler';

export type OperationInputBase = {
  version: '1';
  source: OperationInputSource;
  hostRef: string;
  projectId?: string | null;
  entityName?: string;
  hostLabel?: string;
  workspacePath?: string;
  branchName?: string;
  confirmedAt?: number;
  createdAt: number;
};

export type LifecycleOperationParams = {
  operationId: string;
  kind: OperationKind;
  projectId?: string | null;
  taskId?: string | null;
  workspaceId?: string | null;
  entityKey?: string | null;
  hostRef: string;
  payload: Partial<OperationPayload>;
  confirmedAt?: number | null;
  createdAt: number;
  initiatedBy?: string | null;
  attempt?: number;
};

export type OperationMutationResult = {
  operationId?: string;
};

export type OperationSubmitOptions = {
  precondition?: (tx: DrizzleTx) => OperationMutationError | undefined;
  tombstone?: (tx: DrizzleTx) => number;
  revertTombstone?: (tx: DrizzleTx) => void;
};

export type OperationReconcileContext = {
  db: AppDb;
  clock: Clock;
  submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    options?: OperationSubmitOptions
  ): Promise<void>;
  hasActiveKey(key: string): Promise<boolean>;
};

export type OperationForgetContext = {
  record: OperationRecord;
  db: AppDb;
  clock: Clock;
};

export type OperationDefinition<D extends AnyOperationDefinition = AnyOperationDefinition> = {
  definition: D;
  handler: OperationHandler<D>;
  entityKind: OperationEntityKind;
  examples: readonly { definition: D; input: InputOf<D> }[];
  conflictPolicies?: readonly ConflictPolicy[];
  describe(input: InputOf<D>): OperationDescription;
  projectId(input: InputOf<D>): string | undefined;
  hostRef(input: InputOf<D>): string;
  confirmedInput(
    input: InputOf<D>,
    confirmedAt: number,
    reason: OperationConfirmationReason
  ): InputOf<D>;
  purge?(context: {
    input: InputOf<D>;
    record: OperationRecord;
    db: AppDb;
    clock: Clock;
  }): Promise<void>;
  reconcile?(context: OperationReconcileContext): Promise<void>;
};

export type OperationRuntimeContext = {
  db: AppDb;
  clock: Clock;
  initiatedBy?: string;
};

export type OperationContribution<TDeps> = {
  create(dependencies: TDeps, runtime: OperationRuntimeContext): readonly OperationDefinition[];
};

export type OperationClaimInput = readonly ResourceClaim[];

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
