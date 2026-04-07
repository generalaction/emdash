import { BrowserWindow } from 'electron';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { Pty } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { createClassifier } from './classifiers';
import { stripAnsi, type ClassificationResult } from './classifiers/base';
import { maybeShowNotification } from './notification';

const IDLE_THRESHOLD_MS = 2500;
const COOLDOWN_MS = 10_000;
const EDGE_RESET_THRESHOLD = 20;

// ── Helpers ──────────────────────────────────────────────────────────

function isSubstantiveOutput(chunk: string): boolean {
  return stripAnsi(chunk).trim().length > 0;
}

function classificationKey(result: ClassificationResult): string | undefined {
  if (!result) return undefined;
  return result.type === 'notification' ? `${result.type}:${result.notificationType}` : result.type;
}

function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
}

// ── Emission guard ───────────────────────────────────────────────────

function createEmissionGuard() {
  let lastEmittedKey: string | undefined;
  let lastEmitTime = 0;
  let chunksSinceLastEmit = 0;

  return {
    onVisibleChunk() {
      chunksSinceLastEmit++;
      if (chunksSinceLastEmit > EDGE_RESET_THRESHOLD) {
        lastEmittedKey = undefined;
      }
    },

    shouldEmit(result: ClassificationResult): boolean {
      const key = classificationKey(result);

      if (!key) {
        lastEmittedKey = undefined;
        return false;
      }

      if (key === lastEmittedKey) return false;

      const now = Date.now();
      if (now - lastEmitTime < COOLDOWN_MS) return false;

      lastEmittedKey = key;
      lastEmitTime = now;
      chunksSinceLastEmit = 0;
      return true;
    },
  };
}

export function wireAgentClassifier({
  pty,
  providerId,
  projectId,
  taskId,
  conversationId,
}: {
  pty: Pty;
  providerId: AgentProviderId;
  projectId: string;
  taskId: string;
  conversationId: string;
}): void {
  const classifier = createClassifier(providerId);
  const ptyId = makePtyId(providerId, conversationId);
  const guard = createEmissionGuard();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  pty.onExit(() => {
    if (idleTimer) clearTimeout(idleTimer);
  });

  pty.onData((chunk) => {
    classifier.classify(chunk);

    if (!isSubstantiveOutput(chunk)) return;

    guard.onVisibleChunk();

    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try {
        const result = classifier.classify('');
        if (!guard.shouldEmit(result)) return;

        const event: AgentEvent = {
          type: result!.type,
          source: 'classifier',
          ptyId,
          providerId,
          conversationId,
          taskId,
          projectId,
          timestamp: Date.now(),
          payload: {
            message: result!.message,
            notificationType:
              result!.type === 'notification' ? result!.notificationType : undefined,
          },
        };
        const appFocused = isAppFocused();
        void maybeShowNotification(event, appFocused);
        events.emit(agentEventChannel, { event, appFocused });
      } catch (err) {
        log.warn('wireAgentClassifier: idle check failed', { error: String(err) });
      }
    }, IDLE_THRESHOLD_MS);
  });
}
