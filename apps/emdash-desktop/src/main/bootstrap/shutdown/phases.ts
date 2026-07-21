import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { automationsService } from '@main/core/automations/automations-service';
import { disposeOperationsEngine } from '@main/core/operations/operations-engine-instance';
import { projectManager } from '@main/core/projects/project-manager';
import { closeAppDb } from '@main/db/instance';
import { disposeDesktopWireWorkers } from '@main/gateway/desktop-workers';
import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../core/app-scope';
import { runPhase, type Phase } from '../core/phase';
import { disposeNotificationService } from '../core/service-instances';

const CRITICAL_DEADLINE_MS = 5_000;
const GRACE_WINDOW_MS = 400;

const criticalPhases: Phase<void>[] = [
  {
    name: 'acp-agent-status-bridge',
    run: async () => acpAgentStatusBridge.dispose(),
  },
  {
    name: 'tui-agent-status-bridge',
    run: async () => tuiAgentStatusBridge.dispose(),
  },
  {
    name: 'agent-status-service',
    run: async () => agentStatusService.dispose(),
  },
  {
    name: 'operations-engine',
    run: () => disposeOperationsEngine(),
  },
  {
    name: 'project-manager-release',
    run: () => projectManager.release(),
  },
  {
    name: 'desktop-wire-workers',
    run: () => disposeDesktopWireWorkers(),
  },
  {
    name: 'app-scope',
    run: () => appScope.dispose(),
  },
  {
    name: 'database',
    run: () => closeAppDb(),
  },
  {
    name: 'telemetry-service',
    run: () => telemetryService.dispose(),
  },
];

const bestEffortPhases: Phase<void>[] = [
  {
    name: 'project-manager-dispose',
    run: () => projectManager.dispose(),
  },
];

export async function runQuitCleanup(): Promise<void> {
  telemetryService.capture('app_closed');

  automationsService.stop();
  updateService.dispose();
  disposeNotificationService();
  pullRequestsRegistration.dispose();

  await withDeadline(runCriticalPhases(), CRITICAL_DEADLINE_MS).catch((error: unknown) => {
    log.error('quit: critical cleanup failed or timed out', error);
  });

  const graceful = Promise.allSettled(bestEffortPhases.map((phase) => runPhase(phase, undefined)));
  await Promise.race([graceful, delay(GRACE_WINDOW_MS)]);
}

async function runCriticalPhases(): Promise<void> {
  for (const phase of criticalPhases) {
    try {
      await runPhase(phase, undefined);
    } catch (error) {
      log.error(`quit: critical phase ${phase.name} failed`, error);
    }
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  void promise.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
