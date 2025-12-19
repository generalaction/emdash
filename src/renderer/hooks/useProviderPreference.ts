import { useEffect, useState } from 'react';

export type ProviderId = 'codex' | 'claude';

export function useProviderPreference(
  taskId: string,
  conversationId: string | null,
  initial: ProviderId = 'codex'
) {
  const [provider, setProvider] = useState<ProviderId>(initial);

  // Reset to initial when switching tasks before conversation is available
  useEffect(() => {
    if (!conversationId) {
      setProvider(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, conversationId]);

  // Restore preferred provider for this conversation/task
  useEffect(() => {
    if (!conversationId) return;
    try {
      const convoKey = `conversationProvider:${conversationId}`;
      const saved = localStorage.getItem(convoKey) as ProviderId | null;
      if (saved) {
        setProvider(saved);
        return;
      }
      const wkKey = `taskProvider:${taskId}`;
      const wkSaved = localStorage.getItem(wkKey) as ProviderId | null;
      if (wkSaved) setProvider(wkSaved);
    } catch {}
  }, [conversationId, taskId]);

  // Persist provider selection per conversation and task
  useEffect(() => {
    if (!conversationId) return;
    try {
      localStorage.setItem(`conversationProvider:${conversationId}`, provider);
      localStorage.setItem(`taskProvider:${taskId}`, provider);
    } catch {}
  }, [provider, conversationId, taskId]);

  return { provider, setProvider };
}
