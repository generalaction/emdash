import { useEffect } from 'react';
import { initialPromptSentKey } from '../lib/keys';
import { classifyActivity, sampleActivityChunk } from '../lib/activityClassifier';
import { agentStatusStore } from '../lib/agentStatusStore';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import { buildPromptInjectionPayload } from '../lib/terminalInjection';

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

  useEffect(() => {
    if (!enabled) return;
    const trimmed = (prompt || '').trim();
    if (!trimmed) return;
    const sentKey = initialPromptSentKey(scopeId, providerId);
    if (localStorage.getItem(sentKey) === '1') return;

    const ptyId = makePtyId(providerId as ProviderId, ptyKind, scopeId);
    let sent = false;
    let silenceTimer: any = null;
    let eagerTimer: any = null;
    let hardTimer: any = null;
    const send = () => {
      try {
        if (sent) return;
        const pty = (window as any).electronAPI?.ptyInput;
        if (!pty) return;
        agentStatusStore.markUserInputSubmitted({ ptyId });
        const { payload, submitDelayMs } = buildPromptInjectionPayload({
          agent: providerId,
          text: trimmed,
        });
        pty({ id: ptyId, data: payload });
        const submitKey = providerId === 'amp' ? '\n' : '\r';
        setTimeout(() => {
          try {
            pty({ id: ptyId, data: submitKey });
          } catch {}
        }, submitDelayMs);
        localStorage.setItem(sentKey, '1');
        sent = true;
        onSent?.();
      } catch {}
    };

    const offData = (window as any).electronAPI?.onPtyData?.(ptyId, (chunk: string) => {
      // Debounce-based idle: send after a short period of silence
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, 1200);

      // Heuristic: if classifier says idle, trigger a quicker send
      try {
        const signal = classifyActivity(providerId, sampleActivityChunk(chunk));
        if (signal === 'idle' && !sent) {
          setTimeout(send, 250);
        }
      } catch {
        // ignore classifier errors; rely on silence debounce
      }
    });
    const offStarted = (window as any).electronAPI?.onPtyStarted?.((info: { id: string }) => {
      if (info?.id === ptyId) {
        // Start a silence timer in case no output arrives (rare but possible)
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (!sent) send();
        }, 2000);
      }
    });
    eagerTimer = setTimeout(() => {
      if (!sent) send();
    }, 300);
    // Global last-resort fallback if neither event fires
    hardTimer = setTimeout(() => {
      if (!sent) send();
    }, 5000);
    return () => {
      if (eagerTimer) clearTimeout(eagerTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      offStarted?.();
      offData?.();
    };
  }, [enabled, scopeId, providerId, prompt, ptyKind, onSent]);
}
