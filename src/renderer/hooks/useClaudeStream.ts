import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/chat';

declare const window: Window & {
  electronAPI: any;
};

interface Options {
  workspaceId: string;
  workspacePath: string;
}

interface Result {
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  isReady: boolean;
  streamingOutput: string;
  isStreaming: boolean;
  awaitingThinking: boolean;
  seconds: number;
  send: (text: string, attachments?: string) => Promise<{ success: boolean; error?: string }>;
  cancel: () => Promise<{ success: boolean; error?: string }>;
  appendMessage: (m: Message) => void;
}

const useClaudeStream = (options?: Options | null): Result => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [awaitingThinking, setAwaitingThinking] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const bufferRef = useRef('');

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const normalized = useMemo(() => {
    if (!options) return null;
    return { workspaceId: options.workspaceId, workspacePath: options.workspacePath };
  }, [options?.workspaceId, options?.workspacePath]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, [isStreaming]);

  const appendMessage = useCallback((m: Message) => setMessages((prev) => [...prev, m]), []);

  const send = useCallback(
    async (text: string, attachments: string = '') => {
      if (!normalized) return { success: false, error: 'workspace-unavailable' };
      if (isStreamingRef.current) return { success: false, error: 'stream-in-progress' };
      const convoId = conversationIdRef.current;
      if (!convoId) return { success: false, error: 'conversation-unavailable' };

      // Save user message
      const userMessage: Message = {
        id: Date.now().toString(),
        content: text,
        sender: 'user',
        timestamp: new Date(),
      };
      try {
        await window.electronAPI.saveMessage({
          id: userMessage.id,
          conversationId: convoId,
          content: userMessage.content,
          sender: userMessage.sender,
        });
      } catch {}
      appendMessage(userMessage);

      // Read config options for claude from localStorage
      let customCommands: string | undefined;
      try {
        const saved = localStorage.getItem('emdash.providerConfig');
        if (saved) {
          const config = JSON.parse(saved);
          const claudeConfig = config['claude'];
          if (claudeConfig?.skipPermissions) {
            customCommands = '--dangerously-skip-permissions';
          }
        }
      } catch (err) {
        console.error('Failed to load provider config:', err);
      }

      setIsStreaming(true);
      setSeconds(0);
      bufferRef.current = '';
      setStreamingOutput('');
      setAwaitingThinking(true);
      try {
        await window.electronAPI.agentSendMessageStream({
          providerId: 'claude',
          workspaceId: normalized.workspaceId,
          worktreePath: normalized.workspacePath,
          message: `${text}${attachments ?? ''}`,
          conversationId: convoId,
          customCommands,
        });
        return { success: true };
      } catch (e: any) {
        setIsStreaming(false);
        setSeconds(0);
        return { success: false, error: e?.message || String(e) };
      }
    },
    [appendMessage, normalized]
  );

  const cancel = useCallback(async () => {
    if (!normalized) return { success: false, error: 'workspace-unavailable' };
    if (!isStreamingRef.current) return { success: false, error: 'not-streaming' };
    try {
      const res = await window.electronAPI.agentStopStream({
        providerId: 'claude',
        workspaceId: normalized.workspaceId,
      });
      if (!res?.success) return { success: false, error: res?.error || 'stop-stream-failed' };
      setIsStreaming(false);
      setSeconds(0);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }, [normalized]);

  useEffect(() => {
    let cancelled = false;
    if (!normalized) {
      setIsLoading(false);
      setIsReady(false);
      setMessages([]);
      setStreamingOutput('');
      setIsStreaming(false);
      setSeconds(0);
      return () => {
        cancelled = true;
      };
    }
    const wid = normalized.workspaceId;

    const loadConversation = async () => {
      setIsLoading(true);
      try {
        const convo = await window.electronAPI.getOrCreateDefaultConversation(wid);
        if (cancelled) return;
        if (convo?.success && convo.conversation) {
          setConversationId(convo.conversation.id);
          const msgs = await window.electronAPI.getMessages(convo.conversation.id);
          if (msgs?.success && Array.isArray(msgs.messages)) {
            setMessages(
              msgs.messages.map((m: any) => ({
                id: m.id,
                content: m.content,
                sender: m.sender,
                timestamp: new Date(m.timestamp),
              }))
            );
          } else {
            setMessages([]);
          }
        } else {
          setConversationId(null);
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsReady(true);
        }
      }
    };
    loadConversation();

    const offOut = window.electronAPI.onAgentStreamOutput((data: any) => {
      if (data.providerId !== 'claude') return;
      if (data.workspaceId !== wid) return;
      const text = data.output || '';
      bufferRef.current += text;
      setStreamingOutput(bufferRef.current);
      if (!isStreamingRef.current) setIsStreaming(true);
      if (text && text.length > 0) setAwaitingThinking(false);
    });
    const offErr = window.electronAPI.onAgentStreamError((data: any) => {
      if (data.providerId !== 'claude') return;
      if (data.workspaceId !== wid) return;
      // Keep streaming but note error in console
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { log } = require('../lib/logger');
        log.error('Claude stream error:', data.error);
      } catch {
        // eslint-disable-next-line no-console
        console.error('Claude stream error:', data.error);
      }
    });
    const offDone = window.electronAPI.onAgentStreamComplete(async (data: any) => {
      if (data.providerId !== 'claude') return;
      if (data.workspaceId !== wid) return;
      setIsStreaming(false);
      setSeconds(0);
      setAwaitingThinking(false);
      const raw = bufferRef.current.trim();
      if (!raw) return;
      const convoId = conversationIdRef.current;
      if (!convoId) return;
      const agentMsg: Message = {
        id: Date.now().toString(),
        content: raw,
        sender: 'agent',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      try {
        await window.electronAPI.saveMessage({
          id: agentMsg.id,
          conversationId: convoId,
          content: agentMsg.content,
          sender: agentMsg.sender,
        });
      } catch {}

      // Show notification
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const hasFocus = document.hasFocus();
        console.log(
          'Claude complete - hasFocus:',
          hasFocus,
          'permission:',
          Notification.permission
        );

        if (!hasFocus && Notification.permission === 'granted') {
          console.log('Showing Claude completion notification');
          new Notification('Claude Finished', {
            body: 'Your Claude agent has completed its task.',
            silent: false,
          });
        }
      }

      bufferRef.current = '';
      setStreamingOutput('');
    });

    return () => {
      offOut?.();
      offErr?.();
      offDone?.();
    };
  }, [normalized]);

  return {
    messages,
    conversationId,
    isLoading,
    isReady,
    streamingOutput,
    isStreaming,
    awaitingThinking,
    seconds,
    send,
    cancel,
    appendMessage,
  };
};

export default useClaudeStream;
