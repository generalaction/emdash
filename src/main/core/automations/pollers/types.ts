import type { AutomationEvent } from '@shared/automations/events';

export type PollerCursor = {
  initialized?: boolean;
  seenIssueIds?: string[];
  seenPrs?: Record<string, 'open' | 'closed' | 'merged'>;
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
