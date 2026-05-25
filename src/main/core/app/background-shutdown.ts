import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { gitWatcherRegistry } from '@main/core/git/git-watcher-registry';
import { projectManager } from '@main/core/projects/project-manager';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import {
  reconcileResourceSampler,
  stopResourceSampler,
} from '@main/core/resource-monitor/resource-sampler';
import { updateService } from '@main/core/updates/update-service';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { DevBackgroundShutdownSimulatedEvent } from '@shared/events/appEvents';
import { parsePtySessionId } from '@shared/ptySessionId';

export type BackgroundShutdownMode = 'simulate' | 'exit';

function captureAgentSessionSnapshots(): DevBackgroundShutdownSimulatedEvent['sessions'] {
  return ptySessionRegistry.listActiveSessions().flatMap((session) => {
    if (!session.metadata?.providerId) return [];
    const parsed = parsePtySessionId(session.sessionId);
    return [
      {
        sessionId: session.sessionId,
        projectId: parsed?.projectId,
        taskId: parsed?.scopeId,
        conversationId: parsed?.leafId,
        providerId: session.metadata.providerId,
        title: session.metadata.title,
        isRemote: session.metadata.isRemote,
        tmuxSessionName: session.metadata.tmuxSessionName,
      },
    ];
  });
}

async function markTmuxSessionsAlive(
  sessions: DevBackgroundShutdownSimulatedEvent['sessions']
): Promise<void> {
  const ctx = new LocalExecutionContext();
  await Promise.all(
    sessions.map(async (session) => {
      if (!session.tmuxSessionName || session.isRemote) return;
      try {
        await ctx.exec('tmux', ['has-session', '-t', session.tmuxSessionName]);
        session.tmuxAlive = true;
      } catch {
        session.tmuxAlive = false;
      }
    })
  );
}

export async function runBackgroundShutdown(
  mode: BackgroundShutdownMode
): Promise<DevBackgroundShutdownSimulatedEvent> {
  const projectIds = projectManager.listProjectIds();
  const sessions = captureAgentSessionSnapshots();

  stopResourceSampler();

  if (mode === 'exit') {
    telemetryService.capture('app_closed');
    await telemetryService.dispose();
    agentHookService.dispose();
    updateService.dispose();
    prSyncScheduler.dispose();
    await gitWatcherRegistry.dispose().catch((e) => {
      log.warn('Failed to dispose git watcher registry:', e);
    });
  }

  try {
    await projectManager.dispose();
  } catch (e) {
    log.error('Failed to shutdown project manager:', e);
    throw e;
  }

  if (mode === 'simulate') {
    await markTmuxSessionsAlive(sessions);
    void reconcileResourceSampler();
    log.info('[dev] Simulated app close (agents detached, UI will reload)', {
      projectIds,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        tmuxSessionName: s.tmuxSessionName,
        tmuxAlive: s.tmuxAlive,
      })),
    });
  }

  return { projectIds, sessions };
}
