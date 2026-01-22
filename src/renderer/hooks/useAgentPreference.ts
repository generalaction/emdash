import { useEffect, useState } from 'react';

export type AgentId = 'codex' | 'claude';

export function useAgentPreference(
  taskId: string,
  conversationId: string | null,
  initial: AgentId = 'codex'
) {
  const [agent, setAgent] = useState<AgentId>(initial);

  // Reset to initial when switching tasks before conversation is available
  useEffect(() => {
    if (!conversationId) {
      setAgent(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, conversationId]);

  // Restore preferred agent for this conversation/task
  useEffect(() => {
    if (!conversationId) return;
    try {
      const convoKey = `conversationAgent:${conversationId}`;
      const saved = localStorage.getItem(convoKey) as AgentId | null;
      if (saved) {
        setAgent(saved);
        return;
      }
      const wkKey = `taskAgent:${taskId}`;
      const wkSaved = localStorage.getItem(wkKey) as AgentId | null;
      if (wkSaved) setAgent(wkSaved);
    } catch {}
  }, [conversationId, taskId]);

  // Persist agent selection per conversation and task
  useEffect(() => {
    if (!conversationId) return;
    try {
      localStorage.setItem(`conversationAgent:${conversationId}`, agent);
      localStorage.setItem(`taskAgent:${taskId}`, agent);
    } catch {}
  }, [agent, conversationId, taskId]);

  return { agent, setAgent };
}
