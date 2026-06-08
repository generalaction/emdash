import type { PrSyncProgress, PullRequest } from '@shared/core/pull-requests/pull-requests';
import { defineEvent } from '@shared/lib/ipc/events';

export const prSyncProgressChannel = defineEvent<PrSyncProgress>('pr:sync-progress');

export const prUpdatedChannel = defineEvent<{ prs: PullRequest[] }>('pr:updated');
