import { eq } from 'drizzle-orm';
import type { AutomationEvent } from '@shared/automations/events';
import { prUpdatedChannel } from '@shared/events/prEvents';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { isGitHubUrl } from '@main/core/github/services/utils';
import { db } from '@main/db/client';
import { projectRemotes } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { hasAnyEnabledEventAutomation } from '../event-cache';
import { dispatchEvent } from '../eventDispatcher';
import { getEventCursor, upsertEventCursor } from '../repo';
import { parseCursor, serializeCursor, trackSeenPrs } from './cursor';

let unsubscribe: (() => void) | null = null;

async function findProjectIdsForRemote(remoteUrl: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectRemotes.projectId })
    .from(projectRemotes)
    .where(eq(projectRemotes.remoteUrl, remoteUrl));
  return Array.from(new Set(rows.map((row) => row.projectId)));
}

function toPrEvent(
  pr: PullRequest,
  projectId: string,
  kind: 'pr.opened' | 'pr.merged' | 'pr.closed'
): AutomationEvent {
  return {
    kind,
    projectId,
    occurredAt: Date.now(),
    payload: {
      ref: pr.identifier ?? pr.url,
      title: pr.title,
      url: pr.url,
      author: pr.author?.userName ?? '',
      number: getPrNumber(pr) ?? 0,
      branch: pr.headRefName,
      baseBranch: pr.baseRefName,
    },
  };
}

async function processBatch(prs: PullRequest[]): Promise<void> {
  if (prs.length === 0) return;
  if (!(await hasAnyEnabledEventAutomation())) return;
  const byRepo = new Map<string, PullRequest[]>();
  for (const pr of prs) {
    if (!isGitHubUrl(pr.repositoryUrl)) continue;
    const list = byRepo.get(pr.repositoryUrl) ?? [];
    list.push(pr);
    byRepo.set(pr.repositoryUrl, list);
  }

  await Promise.all(
    Array.from(byRepo.entries()).map(async ([repositoryUrl, repoPrs]) => {
      const projectIds = await findProjectIdsForRemote(repositoryUrl);
      if (projectIds.length === 0) return;

      await Promise.all(projectIds.map((projectId) => processProjectBatch(projectId, repoPrs)));
    })
  );
}

async function processProjectBatch(projectId: string, repoPrs: PullRequest[]): Promise<void> {
  const cursorRow = await getEventCursor(projectId);
  const cursor = parseCursor(cursorRow?.cursor ?? null) ?? {
    initialized: false,
    seenPrs: {},
  };
  const seen = cursor.seenPrs ?? {};
  const transitions: Record<string, 'open' | 'closed' | 'merged'> = {};
  const eventsToEmit: AutomationEvent[] = [];

  for (const pr of repoPrs) {
    const prev = seen[pr.url];
    if (cursor.initialized) {
      if (prev === undefined && pr.status === 'open') {
        eventsToEmit.push(toPrEvent(pr, projectId, 'pr.opened'));
      } else if (prev !== undefined && prev !== pr.status) {
        if (pr.status === 'merged') {
          eventsToEmit.push(toPrEvent(pr, projectId, 'pr.merged'));
        } else if (pr.status === 'closed') {
          eventsToEmit.push(toPrEvent(pr, projectId, 'pr.closed'));
        }
      }
    }
    transitions[pr.url] = pr.status;
  }

  const nextSerialized = serializeCursor({
    ...cursor,
    initialized: true,
    seenPrs: trackSeenPrs(cursor.seenPrs, transitions),
  });
  if (eventsToEmit.length > 0 || nextSerialized !== cursorRow?.cursor) {
    await upsertEventCursor({ projectId, cursor: nextSerialized });
  }

  await Promise.all(
    eventsToEmit.map((event) =>
      dispatchEvent(event).catch((error) => {
        log.error('automations.pr-subscriber: dispatch failed', {
          kind: event.kind,
          error: String(error),
        });
      })
    )
  );
}

export function startPrEventSubscriber(): void {
  if (unsubscribe) return;
  unsubscribe = events.on(prUpdatedChannel, ({ prs }) => {
    processBatch(prs).catch((error) => {
      log.error('automations.pr-subscriber: batch failed', { error: String(error) });
    });
  });
}

export function stopPrEventSubscriber(): void {
  unsubscribe?.();
  unsubscribe = null;
}
