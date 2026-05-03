import type { AutomationEvent } from '@shared/automations/events';

export type RepoEventState = {
  etag?: string;
  /** ISO timestamp of the last successful poll for this repo. */
  lastSyncedAt?: string;
};

export type PollerCursor = {
  initialized?: boolean;
  seenIssueIds?: string[];
  seenPrs?: Record<string, 'open' | 'closed' | 'merged'>;
  /** Per-repo conditional-request state, keyed by repositoryUrl. */
  repoStates?: Record<string, RepoEventState>;
};

export type PollerResult = {
  events: AutomationEvent[];
  cursor: PollerCursor;
};

export type Poller = {
  poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult>;
};

export const MAX_SEEN_ISSUES = 500;
export const MAX_SEEN_PRS = 200;
