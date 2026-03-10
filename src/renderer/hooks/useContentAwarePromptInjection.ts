import { useEffect, useState } from 'react';
import { initialPromptSentKey } from '../lib/keys';
import { classifyActivity } from '../lib/activityClassifier';
import { agentStatusStore } from '../lib/agentStatusStore';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import { hasContentWorkflow, enhancePromptFromTaskMetadata } from '../lib/contentPromptEnhancer';

/**
 * Enhanced prompt injection hook that adds content context when available.
 *
 * Similar to useInitialPromptInjection but:
 * 1. Checks if task has content workflow metadata (collectionId, brief)
 * 2. If so, enhances the prompt with brand guidelines and knowledge documents
 * 3. Injects the enhanced prompt into the terminal
 */
export function useContentAwarePromptInjection(opts: {
  taskId: string;
  providerId: string;
  prompt?: string | null;
  taskMetadata?: Record<string, unknown> | null;
  enabled?: boolean;
}) {
  const { taskId, providerId, prompt, taskMetadata, enabled = true } = opts;
  const [isEnhancing, setIsEnhancing] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const trimmed = (prompt || '').trim();
    if (!trimmed) return;

    const sentKey = initialPromptSentKey(taskId, providerId);
    if (localStorage.getItem(sentKey) === '1') return;

    const ptyId = makePtyId(providerId as ProviderId, 'main', taskId);
    let sent = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let enhancedPrompt: string = trimmed;

    // Enhance prompt with content context if applicable
    const preparePrompt = async () => {
      if (hasContentWorkflow(taskMetadata)) {
        setIsEnhancing(true);
        try {
          const result = await enhancePromptFromTaskMetadata(trimmed, taskMetadata);
          enhancedPrompt = result.prompt;
        } catch (err) {
          console.error('Failed to enhance prompt with content context:', err);
          // Fall back to original prompt
        } finally {
          setIsEnhancing(false);
        }
      }
    };

    const send = () => {
      try {
        if (sent) return;
        agentStatusStore.markUserInputSubmitted({ ptyId });
        (
          window as unknown as {
            electronAPI: { ptyInput: (args: { id: string; data: string }) => void };
          }
        ).electronAPI?.ptyInput?.({ id: ptyId, data: enhancedPrompt + '\n' });
        localStorage.setItem(sentKey, '1');
        sent = true;
      } catch {
        // Ignore errors
      }
    };

    // Start preparing the enhanced prompt
    void preparePrompt();

    const offData = (
      window as unknown as {
        electronAPI: { onPtyData: (ptyId: string, cb: (chunk: string) => void) => () => void };
      }
    ).electronAPI?.onPtyData?.(ptyId, (chunk: string) => {
      // Debounce-based idle: send after a short period of silence
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!sent) send();
      }, 1200);

      // Heuristic: if classifier says idle, trigger a quicker send
      try {
        const signal = classifyActivity(providerId, chunk);
        if (signal === 'idle' && !sent) {
          setTimeout(send, 250);
        }
      } catch {
        // ignore classifier errors; rely on silence debounce
      }
    });

    const offStarted = (
      window as unknown as {
        electronAPI: { onPtyStarted: (cb: (info: { id: string }) => void) => () => void };
      }
    ).electronAPI?.onPtyStarted?.((info: { id: string }) => {
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
  }, [enabled, taskId, providerId, prompt, taskMetadata]);

  return { isEnhancing };
}
