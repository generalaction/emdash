import { KeyedMutex } from '@emdash/core/lib';
import { eq } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { taskService } from '@main/core/tasks/task-service';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { taskAutoCleanupChannel } from '@shared/core/tasks/taskEvents';
import {
  listPrAutoCleanupCandidates,
  type PrAutoCleanupCandidate,
} from './pr-auto-cleanup-candidates';

export type PrAutoCleanupAction = 'archive' | 'delete';

export type PrAutoCleanupMarker = {
  version: 1;
  prUrl: string;
  action: PrAutoCleanupAction;
  completedAt: string;
};

type PrAutoCleanupKv = Record<string, PrAutoCleanupMarker>;

export type PrAutoCleanupDependencies = {
  getMode(): Promise<'off' | PrAutoCleanupAction>;
  listCandidates(repositoryUrl: string): Promise<PrAutoCleanupCandidate[]>;
  isTaskActive(taskId: string): Promise<boolean>;
  getMarker(taskId: string): Promise<PrAutoCleanupMarker | null>;
  cleanup(candidate: PrAutoCleanupCandidate, action: PrAutoCleanupAction): Promise<void>;
  setMarker(taskId: string, marker: PrAutoCleanupMarker): Promise<void>;
  notify(candidate: PrAutoCleanupCandidate, action: PrAutoCleanupAction): void;
};

export class PrAutoCleanupService {
  private readonly mutex = new KeyedMutex();
  private readonly completedInMemory = new Map<string, PrAutoCleanupMarker>();

  constructor(private readonly deps: PrAutoCleanupDependencies = productionDependencies) {}

  async processRepository(repositoryUrl: string): Promise<void> {
    const mode = await this.deps.getMode();
    if (mode === 'off') return;

    const candidates = await this.deps.listCandidates(repositoryUrl);
    await Promise.all(candidates.map((candidate) => this.processCandidate(candidate, mode)));
  }

  private async processCandidate(
    candidate: PrAutoCleanupCandidate,
    action: PrAutoCleanupAction
  ): Promise<void> {
    await this.mutex.runExclusive(candidate.taskId, async () => {
      try {
        const [active, persistedMarker] = await Promise.all([
          this.deps.isTaskActive(candidate.taskId),
          this.deps.getMarker(candidate.taskId),
        ]);
        const marker = persistedMarker ?? this.completedInMemory.get(candidate.taskId);
        if (!active || marker?.prUrl === candidate.prUrl) return;

        await this.deps.cleanup(candidate, action);
        const completedMarker: PrAutoCleanupMarker = {
          version: 1,
          prUrl: candidate.prUrl,
          action,
          completedAt: new Date().toISOString(),
        };
        this.completedInMemory.set(candidate.taskId, completedMarker);
        try {
          await this.deps.setMarker(candidate.taskId, completedMarker);
        } catch (error) {
          // Cleanup has already succeeded and cannot always be rolled back (delete).
          // Retain an in-memory marker to prevent duplicate work in this app session.
          log.warn('PrAutoCleanupService: failed to persist completion marker', {
            taskId: candidate.taskId,
            prUrl: candidate.prUrl,
            action,
            error: String(error),
          });
        }
        this.deps.notify(candidate, action);
      } catch (error) {
        // A failed TaskService cleanup intentionally leaves the marker absent so the
        // next successful PR sync can retry without losing teardown work.
        log.warn('PrAutoCleanupService: cleanup failed', {
          taskId: candidate.taskId,
          prUrl: candidate.prUrl,
          action,
          error: String(error),
        });
      }
    });
  }
}

const markerStore = new KV<PrAutoCleanupKv>('pr-auto-cleanup');

const productionDependencies: PrAutoCleanupDependencies = {
  getMode: async () => (await appSettingsService.get('tasks')).autoCleanupOnPrMerge,
  listCandidates: listPrAutoCleanupCandidates,
  isTaskActive: async (taskId) => {
    const [row] = await db
      .select({ archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return row != null && row.archivedAt == null;
  },
  getMarker: (taskId) => markerStore.get(taskId),
  cleanup: async (candidate, action) => {
    if (action === 'archive') {
      await taskService.archiveTask(candidate.projectId, candidate.taskId);
    } else {
      await taskService.deleteTask(candidate.projectId, candidate.taskId);
    }
  },
  setMarker: (taskId, marker) => markerStore.setOrThrow(taskId, marker),
  notify: (candidate, action) => {
    events.emit(taskAutoCleanupChannel, {
      taskId: candidate.taskId,
      projectId: candidate.projectId,
      taskName: candidate.taskName,
      prUrl: candidate.prUrl,
      action,
    });
  },
};

export const prAutoCleanupService = new PrAutoCleanupService();
