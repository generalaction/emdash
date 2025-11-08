import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '../types/chat';
import { defaultPipeline, type FilterContext } from '../lib/filters';

interface UseCodexStreamOptions {
  workspaceId: string;
  workspacePath: string;
  initialFilter?: unknown;
}

interface UseCodexStreamResult {
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  isReady: boolean;
  streamingOutput: string;
  isStreaming: boolean;
  awaitingThinking: boolean;
  seconds: number;
  send: (
    text: string,
    attachments?: string,
    wirePrefix?: string
  ) => Promise<{ success: boolean; error?: string }>;
  cancel: () => Promise<{ success: boolean; error?: string }>;
  appendMessage: (message: Message) => void;
}

declare const window: Window & {
  electronAPI: {
    getOrCreateDefaultConversation: (
      workspaceId: string
    ) => Promise<{ success: boolean; conversation?: { id: string }; error?: string }>;
    getMessages: (
      conversationId: string
    ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
    saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
    codexSendMessageStream: (
      workspaceId: string,
      message: string,
      conversationId?: string
    ) => Promise<any>;
    codexStopStream: (
      workspaceId: string
    ) => Promise<{ success: boolean; error?: string } | undefined>;
    onCodexStreamOutput: (
      listener: (data: {
        workspaceId: string;
        output: string;
        agentId: string;
        conversationId?: string;
      }) => void
    ) => () => void;
    onCodexStreamError: (
      listener: (data: {
        workspaceId: string;
        error: string;
        agentId: string;
        conversationId?: string;
      }) => void
    ) => () => void;
    onCodexStreamComplete: (
      listener: (data: {
        workspaceId: string;
        exitCode: number;
        agentId: string;
        conversationId?: string;
      }) => void
    ) => () => void;
    codexGetStreamTail: (
      workspaceId: string
    ) => Promise<{ success: boolean; tail?: string; startedAt?: string; error?: string }>;
  };
};

const useCodexStream = (options?: UseCodexStreamOptions | null): UseCodexStreamResult => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [awaitingThinking, setAwaitingThinking] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const streamBufferRef = useRef('');
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameRef = useRef<number | null>(null);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const normalizedOptions = useMemo(() => {
    if (!options) return null;
    return {
      workspaceId: options.workspaceId,
      workspacePath: options.workspacePath,
    };
  }, [options?.workspaceId, options?.workspacePath]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!isStreaming) {
      clearTimer();
      // do not reset seconds here; preserve elapsed across view switches
      return;
    }

    // start ticking from whatever the current seconds value is
    timerRef.current = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      clearTimer();
    };
  }, [isStreaming]);

  const cancelScheduledFrame = useCallback(() => {
    const frameId = frameRef.current;
    if (frameId !== null) {
      if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(frameId);
      }
      frameRef.current = null;
    }
  }, []);

  const resetStreamState = useCallback(() => {
    cancelScheduledFrame();
    streamBufferRef.current = '';
    setStreamingOutput('');
    setAwaitingThinking(false);
  }, [cancelScheduledFrame]);

  const scheduleStreamingUpdate = useCallback(() => {
    if (!normalizedOptions) return;
    if (frameRef.current !== null) return;

    const flush = () => {
      frameRef.current = null;
      if (!normalizedOptions) return;

      const ctx: FilterContext = {
        phase: 'chunk',
        workspaceId: normalizedOptions.workspaceId,
        conversationId: conversationIdRef.current,
      };

      // Guard: don't show raw stream until Codex has emitted a thinking/codex marker
      const buf = streamBufferRef.current || '';
      const hasMarker = /\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+\]\s*(thinking|codex)/i.test(buf);
      if (!hasMarker) {
        // keep streaming area blank to avoid flashing user prompt/tools output
        setStreamingOutput('');
        setAwaitingThinking(true);
        return;
      }

      setAwaitingThinking(false);
      setStreamingOutput(defaultPipeline(buf, ctx));
    };

    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      frameRef.current = window.requestAnimationFrame(flush);
    } else {
      flush();
    }
  }, [normalizedOptions]);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const send = useCallback(
    async (text: string, attachments: string = '', wirePrefix: string = '') => {
      if (!normalizedOptions) {
        return { success: false, error: 'workspace-unavailable' };
      }

      if (isStreamingRef.current) {
        return { success: false, error: 'stream-in-progress' };
      }

      const convoId = conversationIdRef.current;
      if (!convoId) {
        return { success: false, error: 'conversation-unavailable' };
      }

      const { stripMentions, extractMentions } = await import('../lib/attachments');
      const displayText = stripMentions(text);
      const mentionList = extractMentions(text);

      const userMessage: Message = {
        id: Date.now().toString(),
        content: displayText,
        sender: 'user',
        timestamp: new Date(),
        attachments: mentionList,
      };

      try {
        await window.electronAPI.saveMessage({
          id: userMessage.id,
          conversationId: convoId,
          content: userMessage.content,
          sender: userMessage.sender,
          metadata: JSON.stringify({
            workspaceId: normalizedOptions.workspaceId,
            attachments: mentionList,
          }),
        });
      } catch (error) {
        console.error('Failed to save user message:', error);
      }

      appendMessage(userMessage);

      cancelledRef.current = false;
      resetStreamState();
      setIsStreaming(true);
      setSeconds(0);

      try {
        await window.electronAPI.codexSendMessageStream(
          normalizedOptions.workspaceId,
          `${wirePrefix || ''}${text}${attachments ?? ''}`,
          conversationIdRef.current ?? undefined
        );
        return { success: true };
      } catch (error) {
        console.error('Error starting Codex stream:', error);
        cancelledRef.current = false;
        setIsStreaming(false);
        setSeconds(0);
        resetStreamState();
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'stream-start-failed',
        };
      }
    },
    [appendMessage, normalizedOptions, resetStreamState]
  );

  const cancel = useCallback(async () => {
    if (!normalizedOptions) {
      return { success: false, error: 'workspace-unavailable' };
    }

    if (!isStreamingRef.current) {
      return { success: false, error: 'not-streaming' };
    }

    cancelledRef.current = true;

    try {
      const result = await window.electronAPI.codexStopStream(normalizedOptions.workspaceId);
      if (!result?.success) {
        cancelledRef.current = false;
        return {
          success: false,
          error: result?.error ?? 'stop-stream-failed',
        };
      }
    } catch (error) {
      cancelledRef.current = false;
      console.error('Failed to stop Codex stream:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'stop-stream-error',
      };
    }

    setIsStreaming(false);
    setSeconds(0);

    return { success: true };
  }, [normalizedOptions]);

  useEffect(() => {
    let isCancelled = false;

    if (!normalizedOptions) {
      setMessages([]);
      setConversationId(null);
      setIsLoading(false);
      setIsReady(false);
      resetStreamState();
      setIsStreaming(false);
      setSeconds(0);
      return () => {
        isCancelled = true;
      };
    }

    const { workspaceId } = normalizedOptions;

    const loadConversation = async () => {
      setIsLoading(true);
      setIsReady(false);
      try {
        const conversationResult =
          await window.electronAPI.getOrCreateDefaultConversation(workspaceId);

        if (!conversationResult.success || !conversationResult.conversation) {
          console.error('Failed to load conversation:', conversationResult.error);
          return;
        }

        if (isCancelled) return;

        const convoId = conversationResult.conversation.id;
        setConversationId(convoId);

        const messagesResult = await window.electronAPI.getMessages(convoId);

        if (!messagesResult.success || !messagesResult.messages) {
          console.error('Failed to load messages:', messagesResult.error);
          setMessages([]);
          return;
        }

        if (isCancelled) return;

        const loadedMessages: Message[] = messagesResult.messages.map((msg) => {
          const ctx: FilterContext = {
            phase: 'historical',
            workspaceId: normalizedOptions.workspaceId,
            conversationId: convoId,
          };

          let attachments: string[] | undefined;
          try {
            if (msg.metadata && msg.sender === 'user') {
              const meta = JSON.parse(msg.metadata);
              if (meta && Array.isArray(meta.attachments) && meta.attachments.length > 0) {
                attachments = meta.attachments;
              }
            }
          } catch {}

          return {
            id: msg.id,
            content: defaultPipeline(msg.content, ctx),
            sender: msg.sender as 'user' | 'agent',
            timestamp: new Date(msg.timestamp),
            attachments,
          };
        });

        setMessages(loadedMessages);

        // If a stream is currently running for this workspace, seed the UI
        // with the current streaming tail so switching views doesn't lose context.
        try {
          const tailRes = await window.electronAPI.codexGetStreamTail(workspaceId);
          if (tailRes?.success && typeof tailRes.tail === 'string' && tailRes.tail.trim()) {
            // Seed buffer and mark as streaming
            streamBufferRef.current = tailRes.tail;
            setStreamingOutput(tailRes.tail);
            if (tailRes.startedAt) {
              const started = Date.parse(tailRes.startedAt);
              if (!Number.isNaN(started)) {
                const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
                setSeconds(elapsed);
              }
            }
            setIsStreaming(true);
          }
        } catch {}
      } catch (error) {
        console.error('Error loading Codex conversation:', error);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
          setIsReady(true);
        }
      }
    };

    loadConversation();

    return () => {
      isCancelled = true;
    };
  }, [normalizedOptions, resetStreamState]);

  useEffect(() => {
    if (!normalizedOptions) return;

    const { workspaceId } = normalizedOptions;

    const handleOutput = (data: {
      workspaceId: string;
      output: string;
      agentId: string;
      conversationId?: string;
    }) => {
      if (data.workspaceId !== workspaceId) return;
      const currentConversation = conversationIdRef.current;
      if (
        data.conversationId &&
        currentConversation &&
        data.conversationId !== currentConversation
      ) {
        return;
      }

      streamBufferRef.current += data.output;

      scheduleStreamingUpdate();

      if (!cancelledRef.current) {
        setIsStreaming(true);
      }
    };

    const handleError = (data: {
      workspaceId: string;
      error: string;
      agentId: string;
      conversationId?: string;
    }) => {
      if (data.workspaceId !== workspaceId) return;
      const currentConversation = conversationIdRef.current;
      if (
        data.conversationId &&
        currentConversation &&
        data.conversationId !== currentConversation
      ) {
        return;
      }

      console.error('Codex streaming error:', data.error);
      cancelledRef.current = false;
      setIsStreaming(false);
      setSeconds(0);
      resetStreamState();
    };

    const handleComplete = (data: {
      workspaceId: string;
      exitCode: number;
      agentId: string;
      conversationId?: string;
    }) => {
      if (data.workspaceId !== workspaceId) return;
      const currentConversation = conversationIdRef.current;
      if (
        data.conversationId &&
        currentConversation &&
        data.conversationId !== currentConversation
      ) {
        return;
      }

      setIsStreaming(false);
      setSeconds(0);

      if (cancelledRef.current) {
        cancelledRef.current = false;
        return;
      }

      const rawOutput = streamBufferRef.current;
      const trimmed = rawOutput.trim();

      if (!trimmed) {
        resetStreamState();
        return;
      }

      const activeConversationId = conversationIdRef.current;
      if (!activeConversationId) {
        resetStreamState();
        return;
      }

      const renderedContent = defaultPipeline(trimmed, {
        phase: 'final',
        workspaceId,
        conversationId: activeConversationId,
      });

      const agentMessage: Message = {
        id: Date.now().toString(),
        content: renderedContent,
        sender: 'agent',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, agentMessage]);

      // Main process now persists the final agent message. We only update UI state.
      resetStreamState();
    };

    const unsubscribeOutput = window.electronAPI.onCodexStreamOutput(handleOutput);
    const unsubscribeError = window.electronAPI.onCodexStreamError(handleError);
    const unsubscribeComplete = window.electronAPI.onCodexStreamComplete(handleComplete);

    return () => {
      unsubscribeOutput?.();
      unsubscribeError?.();
      unsubscribeComplete?.();
      resetStreamState();
      cancelledRef.current = false;
      setIsStreaming(false);
      setSeconds(0);
    };
  }, [normalizedOptions, resetStreamState, scheduleStreamingUpdate]);

  useEffect(() => {
    return () => {
      clearTimer();
      cancelScheduledFrame();
    };
  }, [cancelScheduledFrame]);

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

export default useCodexStream;
