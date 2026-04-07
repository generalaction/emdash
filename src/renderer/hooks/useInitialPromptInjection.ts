import { useEffect, useRef } from 'react';
import { initialPromptSentKey } from '../lib/keys';
import { classifyActivity, sampleActivityChunk } from '../lib/activityClassifier';
import { agentStatusStore } from '../lib/agentStatusStore';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import {
  buildPromptInjectionPayload,
  getPromptSubmitKey,
  getSlowStartupConfig,
} from '../lib/terminalInjection';

// Default timing for providers without slow-startup config
const DEFAULT_SILENCE_AFTER_STARTED_MS = 2000;
const DEFAULT_EAGER_TIMER_MS = 300;
const DEFAULT_HARD_TIMER_MS = 5000;
const IDLE_SEND_DELAY_MS = 250;
const SILENCE_DEBOUNCE_MS = 1200;

/**
 * Injects an initial prompt into the provider's terminal once the PTY is ready.
 * One-shot per PTY scope. Provider-agnostic.
 */
export function useInitialPromptInjection(opts: {
  scopeId: string;
  providerId: string; // codex | claude | ... used for PTY id prefix
  prompt?: string | null;
  enabled?: boolean;
  ptyKind?: 'main' | 'chat';
  onSent?: () => void;
}) {
  const { scopeId, providerId, prompt, enabled = true, ptyKind = 'main', onSent } = opts;

  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  useEffect(() => {
    if (!enabled) return;
    const trimmed = (prompt || '').trim();
    if (!trimmed) return;
    const sentKey = initialPromptSentKey(scopeId, providerId);
    if (localStorage.getItem(sentKey) === '1') return;

    const ptyId = makePtyId(providerId as ProviderId, ptyKind, scopeId);
    const cfg = getSlowStartupConfig(providerId);
    const submitKey = getPromptSubmitKey(providerId);

    let sent = false;
    let submitConfirmed = false;
    let promptPersisted = false;
    let promptNotified = false;
    let ptyReady = false;
    let sawIdleBeforeSend = false;
    let retryCount = 0;
    let lastSubmitAt = 0;
    const effectStartedAt = Date.now();

    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let eagerTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let idleSendTimer: ReturnType<typeof setTimeout> | null = null;
    const submitTimers: Array<ReturnType<typeof setTimeout>> = [];

    const persistPromptSent = () => {
      if (promptPersisted) return;
      promptPersisted = true;
      localStorage.setItem(sentKey, '1');
    };

    const notifyPromptSent = () => {
      if (promptNotified) return;
      promptNotified = true;
      onSentRef.current?.();
    };

    const stopRetries = () => {
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
      if (retryDeadlineTimer) {
        clearTimeout(retryDeadlineTimer);
        retryDeadlineTimer = null;
      }
    };

    const logDevError = (message: string, error: unknown, context?: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'development') return;
      if (context) {
        console.error(message, error, context);
        return;
      }
      console.error(message, error);
    };

    const sendSubmit = (pty: ((arg: { id: string; data: string }) => void) | undefined) => {
      if (!pty) return;
      try {
        pty({ id: ptyId, data: submitKey });
        lastSubmitAt = Date.now();
      } catch (err) {
        logDevError('[useInitialPromptInjection] pty submit failed:', err, {
          ptyId,
          providerId,
          scopeId,
          ptyKind,
        });
      }
    };

    const send = (force = false) => {
      try {
        if (sent) return;
        if (!force && !ptyReady) return;
        if (cfg && !sawIdleBeforeSend) {
          if (force) {
            // Fallback timers bypass the idle-before-send requirement
            sawIdleBeforeSend = true;
          } else {
            const startupAgeMs = Date.now() - effectStartedAt;
            if (startupAgeMs < cfg.minStartupBeforeSendMs) return;
          }
        }
        const pty = (window as any).electronAPI?.ptyInput;
        if (!pty) return;
        agentStatusStore.markUserInputSubmitted({ ptyId });
        const { payload, submitDelayMs } = buildPromptInjectionPayload({
          agent: providerId,
          text: trimmed,
        });
        pty({ id: ptyId, data: payload });

        const scheduleSubmit = (delayMs: number) => {
          const t = setTimeout(() => {
            sendSubmit(pty);
            if (!cfg) {
              persistPromptSent();
              notifyPromptSent();
            }
          }, delayMs);
          submitTimers.push(t);
        };

        if (cfg) {
          // Some providers can spend a long time in MCP/startup. Keep submitting Enter
          // until we observe an idle->busy transition after injection.
          scheduleSubmit(submitDelayMs);
          // Mark a submit as pending so idle-nudge cooldown checks don't
          // bypass the scheduled submitDelayMs for the initial chunk.
          lastSubmitAt = Date.now();
          retryTimer = setInterval(() => {
            if (submitConfirmed) {
              stopRetries();
              return;
            }
            if (retryCount >= cfg.maxSubmitRetries) {
              stopRetries();
              persistPromptSent();
              notifyPromptSent();
              submitConfirmed = true;
              return;
            }
            retryCount += 1;
            sendSubmit(pty);
          }, cfg.retryIntervalMs);
          // Safety cap: never allow infinite submit retries.
          retryDeadlineTimer = setTimeout(() => {
            if (submitConfirmed) return;
            submitConfirmed = true;
            stopRetries();
            persistPromptSent();
            notifyPromptSent();
          }, cfg.retryDeadlineMs);
        } else {
          scheduleSubmit(submitDelayMs);
        }
        sent = true;
        // Injection succeeded — clear remaining fallback timers
        if (eagerTimer) {
          clearTimeout(eagerTimer);
          eagerTimer = null;
        }
        if (hardTimer) {
          clearTimeout(hardTimer);
          hardTimer = null;
        }
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
        if (idleSendTimer) {
          clearTimeout(idleSendTimer);
          idleSendTimer = null;
        }
      } catch (err) {
        logDevError('[useInitialPromptInjection] prompt injection failed:', err, {
          ptyId,
          providerId,
          scopeId,
          ptyKind,
          force,
          ptyReady,
          sent,
        });
      }
    };

    const offData = (window as any).electronAPI?.onPtyData?.(ptyId, (chunk: string) => {
      ptyReady = true;
      // Debounce-based idle: send after a short period of silence
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, SILENCE_DEBOUNCE_MS);

      // Heuristic: if classifier says idle, trigger a quicker send
      try {
        const signal = classifyActivity(providerId, sampleActivityChunk(chunk));
        if (signal === 'idle' && !sent) {
          if (cfg) sawIdleBeforeSend = true;
          if (idleSendTimer) clearTimeout(idleSendTimer);
          idleSendTimer = setTimeout(send, IDLE_SEND_DELAY_MS);
        } else if (cfg && sent && !submitConfirmed) {
          // Stop retries as soon as the provider shows active processing.
          if (signal === 'busy') {
            submitConfirmed = true;
            stopRetries();
            persistPromptSent();
            notifyPromptSent();
          } else if (signal === 'idle' && !cfg.skipIdleRetries) {
            // If still idle, nudge submit with a cooldown to avoid Enter bursts from redraw spam.
            if (Date.now() - lastSubmitAt >= cfg.idleRetryCooldownMs) {
              sendSubmit((window as any).electronAPI?.ptyInput);
            }
          }
        }
      } catch {
        // ignore classifier errors; rely on silence debounce
      }
    });

    const offStarted = (window as any).electronAPI?.onPtyStarted?.((info: { id: string }) => {
      if (info?.id === ptyId) {
        ptyReady = true;
        // Start a silence timer in case no output arrives (rare but possible)
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!sent) send();
        }, cfg?.silenceAfterStartedMs ?? DEFAULT_SILENCE_AFTER_STARTED_MS);
      }
    });

    if (!cfg) {
      eagerTimer = setTimeout(() => {
        if (!sent) send(true);
      }, DEFAULT_EAGER_TIMER_MS);
    }

    // Global last-resort fallback if neither event fires
    hardTimer = setTimeout(() => {
      if (!sent) send(true);
    }, cfg?.hardTimerMs ?? DEFAULT_HARD_TIMER_MS);

    return () => {
      if (eagerTimer) clearTimeout(eagerTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (idleSendTimer) clearTimeout(idleSendTimer);
      stopRetries();
      for (const t of submitTimers) clearTimeout(t);
      offStarted?.();
      offData?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSent is stabilized via onSentRef
  }, [enabled, scopeId, providerId, prompt, ptyKind]);
}
