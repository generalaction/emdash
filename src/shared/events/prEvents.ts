import { defineEvent } from '@shared/ipc/events';
import type { PrSyncProgress, PullRequest } from '@shared/pull-requests';

export const prSyncProgressChannel = defineEvent<PrSyncProgress>('pr:sync-progress');

export const prUpdatedChannel = defineEvent<{ prs: PullRequest[] }>('pr:updated');
