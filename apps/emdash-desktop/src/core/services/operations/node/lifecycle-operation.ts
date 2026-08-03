import type { OperationStatus } from '@emdash/core/primitives/operations/api';
import type { OperationKind } from '@core/primitives/operations/api';

export interface LifecycleOperationPayload {
  version?: '2';
  source?: 'user' | 'reconciler';
  entityName?: string;
  hostLabel?: string;
  workspacePath?: string;
  branchName?: string;
  deleteWorktree?: boolean;
  deleteBranch?: boolean;
  acpConversationIds?: string[];
  tuiConversationIds?: string[];
  terminalSessionIds?: string[];
  tmuxSessionNames?: string[];
}

export interface LifecycleOperationRow {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  projectId?: string | null;
  taskId?: string | null;
  workspaceId?: string | null;
  entityKey?: string | null;
  parentOperationId?: string | null;
  parentForgetPolicy?: 'abandon-children' | 'orphan-children' | null;
  initiatedBy?: string | null;
  hostRef: string;
  payload: LifecycleOperationPayload;
  confirmedAt?: number | null;
  confirmationReason?: string | null;
  attempt: number;
  error?: string | null;
  createdAt: number;
  finishedAt?: number | null;
}
