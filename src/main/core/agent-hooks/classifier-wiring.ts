import { BrowserWindow } from 'electron';
import { type Pty } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { createClassifier } from './classifiers';
import { stripAnsi, type ClassificationResult } from './classifiers/base';
import { maybeShowNotification } from './notification';

type EmittableClassificationResult = Exclude<ClassificationResult, undefined>;

const IDLE_THRESHOLD_MS = 2500;
const COOLDOWN_MS = 10_000;
const START_COOLDOWN_MS = 500;
const EDGE_RESET_THRESHOLD = 20;

// ── Helpers ──────────────────────────────────────────────────────────

function isSubstantiveOutput(chunk: string): boolean {
  return stripAnsi(chunk).trim().length > 0;
}

function classificationKey(result: EmittableClassificationResult): string {
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

    shouldEmit(result: EmittableClassificationResult): boolean {
      const key = classificationKey(result);

      if (key === lastEmittedKey) return false;

      const now = Date.now();
      const cooldownMs = result.type === 'start' ? START_COOLDOWN_MS : COOLDOWN_MS;
      if (now - lastEmitTime < cooldownMs) return false;

      lastEmittedKey = key;
      lastEmitTime = now;
      chunksSinceLastEmit = 0;
      return true;
    },

    reset() {
      lastEmittedKey = undefined;
    },
  };
}

function emitClassifierEvent({
  result,
  ptyId,
  providerId,
  conversationId,
  taskId,
  projectId,
}: {
  result: EmittableClassificationResult;
  ptyId: string;
  providerId: AgentProviderId;
  conversationId: string;
  taskId: string;
  projectId: string;
}): void {
  const event: AgentEvent = {
    type: result.type,
    source: 'classifier',
    ptyId,
    providerId,
    conversationId,
    taskId,
    projectId,
    timestamp: Date.now(),
    payload: {
      message: result.message,
      notificationType: result.type === 'notification' ? result.notificationType : undefined,
    },
  };
  const appFocused = isAppFocused();
  void maybeShowNotification(event, appFocused);
  events.emit(agentEventChannel, { event, appFocused });
}

function shouldEmitClassifierResult(
  _providerId: AgentProviderId,
  result: EmittableClassificationResult,
  cursorHooksHandleStop: boolean
): boolean {
  return !(
    cursorHooksHandleStop &&
    result.type === 'notification' &&
    result.notificationType === 'idle_prompt'
  );
}

export function wireAgentClassifier({
  pty,
  providerId,
  projectId,
  taskId,
  conversationId,
  cursorHooksHandleStop = false,
}: {
  pty: Pty;
  providerId: AgentProviderId;
  projectId: string;
  taskId: string;
  conversationId: string;
  cursorHooksHandleStop?: boolean;
}): void {
  const classifier = createClassifier(providerId, { cursorHooksHandleStop });
  const ptyId = makePtyId(providerId, conversationId);
  const guard = createEmissionGuard();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  pty.onExit(() => {
    if (idleTimer) clearTimeout(idleTimer);
  });

  pty.onData((chunk) => {
    const cleanChunk = stripAnsi(chunk);

    if (providerId === 'cursor' && /Thought for \d+ms/i.test(cleanChunk)) {
      guard.reset();
    }

    const result = classifier.classify(chunk);
    if (
      result &&
      shouldEmitClassifierResult(providerId, result, cursorHooksHandleStop) &&
      guard.shouldEmit(result)
    ) {
      if (result.type === 'start' && idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      emitClassifierEvent({ result, ptyId, providerId, conversationId, taskId, projectId });
    }

    if (!isSubstantiveOutput(chunk)) return;

    guard.onVisibleChunk();

    if (cursorHooksHandleStop) return;

    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      try {
        const idleResult = classifier.classify('');
        if (
          !idleResult ||
          !shouldEmitClassifierResult(providerId, idleResult, cursorHooksHandleStop) ||
          !guard.shouldEmit(idleResult)
        ) {
          return;
        }
        emitClassifierEvent({
          result: idleResult,
          ptyId,
          providerId,
          conversationId,
          taskId,
          projectId,
        });
      } catch (err) {
        log.warn('wireAgentClassifier: idle check failed', { error: String(err) });
      }
    }, IDLE_THRESHOLD_MS);
  });
}
