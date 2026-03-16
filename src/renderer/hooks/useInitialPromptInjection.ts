import { useEffect } from 'react';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { events, rpc } from '../core/ipc';
import { classifyActivity } from '../lib/activityClassifier';
import { initialPromptSentKey } from '../lib/keys';

/**
 * Injects an initial prompt into the provider's terminal once the PTY is ready.
 * One-shot per conversation. Provider-agnostic.
 *
 * Subscribes to `ptyDataChannel.{sessionId}` using the deterministic session ID
 * and sends input via `rpc.pty.sendInput` once the terminal looks idle.
 */
export function useInitialPromptInjection(opts: {
  projectId: string;
  taskId: string;
  conversationId: string;
  providerId: string;
  prompt?: string | null;
  enabled?: boolean;
}) {
  const { projectId, taskId, conversationId, providerId, prompt, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    const trimmed = (prompt || '').trim();
    if (!trimmed) return;

    const sentKey = initialPromptSentKey(taskId, providerId);
    if (localStorage.getItem(sentKey) === '1') return;

    const sessionId = makePtySessionId(projectId, taskId, conversationId);
    let sent = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const send = () => {
      if (sent) return;
      void rpc.pty.sendInput(sessionId, trimmed + '\n');
      localStorage.setItem(sentKey, '1');
      sent = true;
    };

    const offData = events.on(
      ptyDataChannel,
      (chunk) => {
        // Debounce: send after a short period of silence.
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!sent) send();
        }, 1200);

        // Heuristic: if classifier says idle, send sooner.
        try {
          const signal = classifyActivity(providerId, chunk);
          if (signal === 'idle' && !sent) {
            setTimeout(send, 250);
          }
        } catch {
          // ignore classifier errors; rely on silence debounce
        }
      },
      sessionId
    );

    // Global last-resort fallback if no output arrives.
    const fallbackTimer = setTimeout(() => {
      if (!sent) send();
    }, 10_000);

    return () => {
      clearTimeout(fallbackTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      offData();
    };
  }, [enabled, projectId, taskId, conversationId, providerId, prompt]);
}
