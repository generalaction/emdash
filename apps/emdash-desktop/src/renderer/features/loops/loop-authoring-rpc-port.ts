import { events, rpc } from '@renderer/lib/ipc';
import { loopPhaseUpdatedChannel, loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type { LoopPhase, LoopWithPhases, PhaseStatus } from '@shared/core/loops/loops';
import type {
  LoopAuthoringPort,
  LoopTabBrowserState,
  LoopTabEvent,
  LoopTabEvidence,
  LoopTabPhaseSnapshot,
  LoopTabSnapshot,
} from './loop-authoring-port';

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return 'Loop request failed';
}

function evidenceStatus(status: PhaseStatus): LoopTabEvidence['status'] {
  if (status === 'passed' || status === 'failed' || status === 'pending') return status;
  return 'running';
}

function mapPhase(phase: LoopPhase): LoopTabPhaseSnapshot {
  const handoff = phase.state?.handoff;
  return {
    id: phase.id,
    index: phase.idx,
    kind: phase.kind ?? 'work',
    name: phase.name,
    goal: phase.goal,
    status: phase.status,
    attempts: phase.attempts,
    lastError: phase.lastError,
    handoff: handoff
      ? {
          summary: handoff.summary,
          risks: [...handoff.risks],
          remainingWork: [...handoff.remainingWork],
          artifacts: handoff.artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            kind: artifact.kind,
            label: artifact.label,
            byteLength: artifact.byteLength,
          })),
        }
      : null,
    evidence: (phase.criteria?.criteria ?? []).map((criterion) => ({
      label: criterion.description,
      status: evidenceStatus(criterion.status),
      summary: criterion.evidence ?? `Criterion is ${criterion.status}.`,
    })),
  };
}

function browserState(loop: LoopWithPhases): LoopTabBrowserState {
  if (loop.config?.version !== '2' || !loop.config.browserPreview.enabled) {
    return { kind: 'disabled' };
  }

  const e2e = loop.phases.find((phase) => phase.kind === 'e2e');
  if (!e2e || e2e.status === 'pending') {
    return { kind: 'waiting', message: 'Waiting for the clean-room E2E phase.' };
  }
  if (e2e.status === 'passed') {
    return {
      kind: 'passed',
      message: e2e.state?.result?.summary ?? 'Browser verification passed.',
    };
  }
  if (e2e.status === 'failed') {
    return {
      kind: 'failed',
      message: e2e.lastError ?? e2e.state?.result?.summary ?? 'Browser verification failed.',
    };
  }

  const verification = loop.state?.verification;
  if (!verification) {
    return { kind: 'waiting', message: 'Preparing the clean-room browser preview.' };
  }
  switch (verification.status) {
    case 'preparing':
      return { kind: 'waiting', message: 'Preparing the clean-room browser preview.' };
    case 'ready':
      return { kind: 'ready', message: 'The clean-room browser preview is ready.' };
    case 'running':
      return { kind: 'running', message: 'Browser verification is running.' };
    case 'integrating-fix':
      return { kind: 'reconnecting', message: 'Recreating the preview after an E2E fix.' };
    case 'destroying':
      return { kind: 'reconnecting', message: 'Closing the disposable browser preview.' };
    case 'cleanup-failed':
      return {
        kind: 'failed',
        message: verification.cleanup.error ?? 'Browser preview cleanup failed.',
      };
  }
}

export function mapLoopTabSnapshot(loop: LoopWithPhases): LoopTabSnapshot {
  return {
    loopId: loop.id,
    taskId: loop.taskId,
    name: loop.name,
    status: loop.status,
    currentPhaseIndex: loop.currentPhaseIndex,
    phases: [...loop.phases].sort((a, b) => a.idx - b.idx).map(mapPhase),
    browser: browserState(loop),
  };
}

async function unwrapLoop(
  request: Promise<Awaited<ReturnType<typeof rpc.loops.getLoop>>>
): Promise<LoopTabSnapshot> {
  const result = await request;
  if (!result.success) throw new Error(errorMessage(result.error));
  return mapLoopTabSnapshot(result.data);
}

export class RpcLoopAuthoringPort implements LoopAuthoringPort {
  loadLoop(loopId: string): Promise<LoopTabSnapshot> {
    return unwrapLoop(rpc.loops.getLoop(loopId));
  }

  subscribeToLoop(loopId: string, listener: (event: LoopTabEvent) => void): () => void {
    let active = true;
    let generation = 0;
    const refresh = (): void => {
      const requestGeneration = ++generation;
      void this.loadLoop(loopId).then(
        (snapshot) => {
          if (active && requestGeneration === generation) {
            listener({ type: 'snapshot', snapshot });
          }
        },
        (error: unknown) => {
          if (active && requestGeneration === generation) {
            listener({ type: 'unavailable', message: errorMessage(error) });
          }
        }
      );
    };

    const offLoop = events.on(loopUpdatedChannel, ({ loop }) => {
      if (loop.id === loopId) refresh();
    });
    const offPhase = events.on(loopPhaseUpdatedChannel, (event) => {
      if (event.loopId === loopId) refresh();
    });
    return () => {
      active = false;
      generation += 1;
      offLoop();
      offPhase();
    };
  }

  async pauseLoop(loopId: string): Promise<LoopTabSnapshot> {
    return unwrapLoop(rpc.loops.pauseLoop(loopId));
  }

  async resumeLoop(loopId: string): Promise<LoopTabSnapshot> {
    return unwrapLoop(rpc.loops.resumeLoop(loopId));
  }

  async retryPhase(loopId: string, phaseId: string): Promise<LoopTabSnapshot> {
    return unwrapLoop(rpc.loops.retryPhase(loopId, phaseId));
  }
}

export const loopAuthoringRpcPort = new RpcLoopAuthoringPort();
