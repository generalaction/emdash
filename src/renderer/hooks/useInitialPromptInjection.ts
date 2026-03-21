import { useEffect } from 'react';
import { initialPromptSentKey } from '../lib/keys';
import { classifyActivity, sampleActivityChunk } from '../lib/activityClassifier';
import { agentStatusStore } from '../lib/agentStatusStore';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';

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
}) {
  const { scopeId, providerId, prompt, enabled = true, ptyKind = 'main' } = opts;

  useEffect(() => {
    if (!enabled) return;
    const trimmed = (prompt || '').trim();
    if (!trimmed) return;
    const sentKey = initialPromptSentKey(scopeId, providerId);
    if (localStorage.getItem(sentKey) === '1') return;

    const ptyId = makePtyId(providerId as ProviderId, ptyKind, scopeId);
    let sent = false;
    let silenceTimer: any = null;
    const send = () => {
      try {
        if (sent) return;
        agentStatusStore.markUserInputSubmitted({ ptyId });
        (window as any).electronAPI?.ptyInput?.({ id: ptyId, data: trimmed + '\n' });
        localStorage.setItem(sentKey, '1');
        sent = true;
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
    // Global last-resort fallback if neither event fires
    const t = setTimeout(() => {
      if (!sent) send();
    }, 10000);
    return () => {
      clearTimeout(t);
      if (silenceTimer) clearTimeout(silenceTimer);
      offStarted?.();
      offData?.();
    };
  }, [enabled, scopeId, providerId, prompt, ptyKind]);
}
