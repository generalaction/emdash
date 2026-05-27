import { agentEventChannel } from '@shared/events/agentEvents';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { taskManager } from '@main/core/tasks/task-manager';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { activityStore } from './activity-store';
import { handleOverlap, handleSiblings } from './http-handlers';
import { scanScheduler, scanTask } from './scanner';
import { ensureBundledSkill } from './skill-installer';

/** Status decay sweeps run on this cadence. */
const DECAY_INTERVAL_MS = 60_000;

/**
 * Multi-agent coordination service.
 *
 * Wiring (passive awareness, auto-derived from git):
 *   1. Register GET /coord/siblings and /coord/overlap on the existing
 *      hook server (no second HTTP server).
 *   2. On taskManager `task:provisioned`: do an initial git scan and mark
 *      the task active.
 *   3. On taskManager `task:torn-down`: cancel scans and mark inactive.
 *   4. On agentEventChannel: stamp `lastEventAt = now`, schedule a scan.
 *   5. Periodic decay timer demotes active → idle → inactive.
 *   6. Install the bundled emdash-coord SKILL.md into each detected agent's
 *      skill directory, once at boot.
 */
class CoordinationService implements IInitializable, IDisposable {
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private readonly disposers: Array<() => void> = [];

  async initialize(): Promise<void> {
    agentHookService.addRoute('GET', '/coord/siblings', (req, res) => handleSiblings(req, res));
    agentHookService.addRoute('GET', '/coord/overlap', (req, res, url) =>
      handleOverlap(req, res, url)
    );

    const unsubProvisioned = taskManager.hooks.on('task:provisioned', async ({ taskId }) => {
      activityStore.markActive(taskId, null);
      try {
        await scanTask(taskId);
      } catch (e) {
        log.warn('coordination: initial scan failed', { taskId, error: String(e) });
      }
    });
    this.disposers.push(unsubProvisioned);

    const unsubTorndown = taskManager.hooks.on('task:torn-down', ({ taskId }) => {
      scanScheduler.cancel(taskId);
      activityStore.markInactive(taskId);
    });
    this.disposers.push(unsubTorndown);

    const unsubAgentEvent = events.on(agentEventChannel, ({ event }) => {
      if (!event.taskId) return;
      // The first sentence of the last assistant message makes a decent
      // human-readable summary for the sibling list. Null-safe; we don't
      // overwrite an existing summary with nothing.
      const summary = pickSummary(event.payload.lastAssistantMessage ?? event.payload.message);
      activityStore.markActive(event.taskId, summary);
      scanScheduler.schedule(event.taskId);
    });
    this.disposers.push(unsubAgentEvent);

    this.decayTimer = setInterval(() => {
      try {
        activityStore.applyStatusDecay();
      } catch (e) {
        log.warn('coordination: decay sweep failed', { error: String(e) });
      }
    }, DECAY_INTERVAL_MS);

    // Install the bundled skill in the background — we don't block boot on it.
    void ensureBundledSkill().catch((e) => {
      log.warn('coordination: ensureBundledSkill failed', { error: String(e) });
    });

    log.info('coordination: initialized');
  }

  dispose(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    scanScheduler.cancelAll();
    activityStore.flush();
    for (const d of this.disposers) {
      try {
        d();
      } catch {
        // best-effort
      }
    }
    this.disposers.length = 0;
  }
}

function pickSummary(s: string | undefined | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // First sentence-ish, capped at 240 chars so a noisy paragraph doesn't
  // make the siblings response unwieldy.
  const firstSentence = trimmed.split(/(?<=[.!?])\s/, 1)[0] ?? trimmed;
  return firstSentence.slice(0, 240);
}

export const coordinationService = new CoordinationService();
