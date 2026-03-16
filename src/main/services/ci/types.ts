import type { ProviderId } from '@shared/providers/registry';

export type CiAutoFixMode = 'auto' | 'review';

export interface CiTriggerFilters {
  include: string[];
  exclude: string[];
}

export interface CiAutoFixConfig {
  enabled: boolean;
  mode: CiAutoFixMode;
  maxRetries: number;
  triggerFilters: CiTriggerFilters;
  maxLogChars: number;
  pollIntervalMs: number;
  providerId?: ProviderId;
}

export interface CiAutoFixConfigOverride {
  enabled?: boolean;
  mode?: CiAutoFixMode;
  maxRetries?: number;
  triggerFilters?: {
    include?: string[];
    exclude?: string[];
  };
  maxLogChars?: number;
  pollIntervalMs?: number;
  providerId?: ProviderId;
}

export interface CiBranchRetryState {
  projectId: string;
  branchName: string;
  retryCount: number;
  halted: boolean;
  lastObservedHeadSha: string | null;
  lastAgentCommitSha: string | null;
  lastHandledRunId: number | null;
  updatedAt: string;
}

export interface CiRetryStateFile {
  version: 1;
  branches: Record<string, CiBranchRetryState>;
}

export interface CiFailedRunInfo {
  runId: number;
  headSha: string;
  workflowName: string;
  displayTitle: string;
  htmlUrl?: string;
  event?: string;
}

export interface CiFailureCandidate {
  projectId: string;
  projectPath: string;
  taskId: string;
  taskPath: string;
  branchName: string;
  run: CiFailedRunInfo;
}

export interface ParsedFailedLog {
  workflowName: string;
  failedStepNames: string[];
  output: string;
  wasTruncated: boolean;
}
