import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  Circle,
  Clipboard,
  Paperclip,
  Square,
  Trash2,
} from 'lucide-react';

// OpenAI logo SVG component
const OpenAIIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
);
import { Task } from '../types/chat';
import { type Provider } from '../types';
import InstallBanner from './InstallBanner';
import { Button } from './ui/button';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type ContentBlock = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  name?: string;
  uri?: string;
  description?: string;
  title?: string;
  size?: number;
  resource?: {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    name?: string;
    title?: string;
    description?: string;
    size?: number;
  };
};

type ToolCallContent =
  | { type: 'content'; content: ContentBlock }
  | { type: 'diff'; path?: string; oldText?: string; newText?: string }
  | { type: 'terminal'; terminalId: string };

type ToolCall = {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  locations?: Array<{ path: string; line?: number }>;
  content?: ToolCallContent[];
  rawInput?: string;
  rawOutput?: string;
};

type FeedItem =
  | {
      id: string;
      type: 'message';
      role: 'user' | 'assistant' | 'system';
      blocks: ContentBlock[];
      streaming?: boolean;
    }
  | { id: string; type: 'tool'; toolCallId: string }
  | {
      id: string;
      type: 'plan';
      entries: Array<{ content?: string; status?: string; priority?: string }>;
    }
  | { id: string; type: 'permission'; requestId: number };

type PermissionRequest = {
  requestId: number;
  toolCall?: ToolCall;
  options?: Array<{ id: string; label: string; kind?: string }>;
};

type Attachment = {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  size?: number;
  kind: 'file' | 'image' | 'audio';
  data?: string;
  textContent?: string;
};

type Props = {
  task: Task;
  projectName: string;
  className?: string;
  provider: Provider;
  isProviderInstalled: boolean | null;
  runInstallCommand: (cmd: string) => void;
};

const statusStyles: Record<string, string> = {
  pending: 'text-amber-700 bg-amber-50 border-amber-200',
  in_progress: 'text-blue-700 bg-blue-50 border-blue-200',
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
  cancelled: 'text-gray-600 bg-gray-100 border-gray-200',
};

const AcpChatInterface: React.FC<Props> = ({
  task,
  projectName: _projectName,
  className,
  provider,
  isProviderInstalled,
  runInstallCommand,
}) => {
  const uiLog = useCallback((...args: any[]) => {
    // eslint-disable-next-line no-console
    console.log('[acp-ui]', ...args);
  }, []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCall>>({});
  const [permissions, setPermissions] = useState<Record<number, PermissionRequest>>({});
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<
    Array<{ name: string; description?: string; hint?: string }>
  >([]);
  const [plan, setPlan] = useState<
    Array<{ content?: string; status?: string; priority?: string }> | null
  >(null);
  const [input, setInput] = useState('');
  const [showPlan, setShowPlan] = useState(true);
  const [agentId, setAgentId] = useState<string>(String(provider || 'codex'));
  const [promptCaps, setPromptCaps] = useState<{
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  }>({});
  const [modelId, setModelId] = useState<string>('gpt-5.2-codex');
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 200;
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [input]);

  useEffect(() => {
    scrollToBottom('auto');
  }, [feed.length, scrollToBottom]);

  useEffect(() => {
    setAgentId(String(provider || 'codex'));
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionError(null);
      uiLog('startSession', { taskId: task.id, provider, cwd: task.path });
      const res = await window.electronAPI.acpStartSession({
        taskId: task.id,
        providerId: provider,
        cwd: task.path,
      });
      uiLog('startSession:response', res);
      if (cancelled) return;
      if (!res?.success || !res.sessionId) {
        uiLog('startSession:failed', res);
        setSessionError(res?.error || 'Failed to start ACP session.');
        return;
      }
      setSessionId(res.sessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id, task.path, provider, uiLog]);

  useEffect(() => {
    if (!sessionId) return;
    return () => {
      try {
        uiLog('disposeSession', { sessionId });
        window.electronAPI.acpDispose({ sessionId });
      } catch {}
    };
  }, [sessionId, uiLog]);

  useEffect(() => {
    const off = window.electronAPI.onAcpEvent((payload: any) => {
      if (!payload || payload.taskId !== task.id) return;
      uiLog('event', payload);
      if (payload.type === 'session_started') {
        if (payload.sessionId) {
          setSessionId(payload.sessionId);
        }
        const caps =
          payload.agentCapabilities?.promptCapabilities ??
          payload.agentCapabilities?.prompt ??
          payload.agentCapabilities?.prompt_caps;
        if (caps) {
          setPromptCaps(normalizePromptCaps(caps));
        }
        return;
      }
      if (payload.type === 'session_error') {
        uiLog('session_error', payload.error);
        setSessionError(payload.error || 'ACP session error');
        setIsRunning(false);
        return;
      }
      if (payload.type === 'session_exit') {
        uiLog('session_exit', payload);
        setIsRunning(false);
        if (!sessionError) {
          setSessionError('ACP session ended.');
        }
        return;
      }
      if (payload.type === 'prompt_end') {
        uiLog('prompt_end', payload);
        setIsRunning(false);
        setFeed((prev) =>
          prev.map((item) =>
            item.type === 'message' && item.streaming ? { ...item, streaming: false } : item
          )
        );
        if (payload.stopReason) {
          const stopReason = String(payload.stopReason).trim();
          if (stopReason && stopReason !== 'end_turn') {
            setFeed((prev) => [
              ...prev,
              {
                id: `stop-${Date.now()}`,
                type: 'message',
                role: 'system',
                blocks: [
                  {
                    type: 'text',
                    text: `Stopped: ${stopReason}`,
                  },
                ],
              },
            ]);
          }
        }
        return;
      }
      if (payload.type === 'terminal_output') {
        uiLog('terminal_output', {
          terminalId: payload.terminalId,
          chunkSize: String(payload.chunk ?? '').length,
        });
        const terminalId = payload.terminalId as string;
        if (!terminalId) return;
        const chunk = String(payload.chunk ?? '');
        if (!chunk) return;
        setTerminalOutputs((prev) => ({
          ...prev,
          [terminalId]: (prev[terminalId] || '') + chunk,
        }));
        return;
      }
      if (payload.type === 'session_update') {
        const update = payload.update;
        if (!update) return;
        const updateType =
          (update.sessionUpdate as string) || (update.type as string) || (update.kind as string);
        if (!updateType) return;
        uiLog('session_update', { updateType, update });
        if (
          updateType === 'agent_message_chunk' ||
          updateType === 'user_message_chunk' ||
          updateType === 'agent_message' ||
          updateType === 'user_message' ||
          updateType === 'thought_message' ||
          updateType === 'thought_message_chunk'
        ) {
          const role =
            updateType === 'agent_message_chunk' || updateType === 'agent_message'
              ? 'assistant'
              : updateType.startsWith('thought')
                ? 'system'
                : 'user';
          const blocks = Array.isArray(update.content)
            ? (update.content as ContentBlock[])
            : update.content
              ? [update.content as ContentBlock]
              : [];
          appendMessage(role, blocks);
          return;
        }
        if (updateType === 'plan') {
          const entries = Array.isArray(update.entries) ? update.entries : [];
          setPlan(entries);
          setFeed((prev) => {
            const existing = prev.find((item) => item.type === 'plan');
            if (existing) {
              return prev.map((item) =>
                item.type === 'plan' ? { ...item, entries } : item
              );
            }
            return [...prev, { id: `plan-${Date.now()}`, type: 'plan', entries }];
          });
          return;
        }
        if (updateType === 'tool_call' || updateType === 'tool_call_update') {
          const payloadUpdate = update.toolCall ?? update;
          const toolCallId = payloadUpdate.toolCallId as string;
          if (!toolCallId) return;
          setToolCalls((prev) => {
            const existing = prev[toolCallId] || { toolCallId };
            let content = existing.content || [];
            if (Array.isArray(payloadUpdate.content)) {
              content = [...content, ...payloadUpdate.content];
            } else if (payloadUpdate.content) {
              content = [...content, payloadUpdate.content];
            }
            const rawInput =
              payloadUpdate.rawInput ?? payloadUpdate.input ?? undefined;
            const rawOutput =
              payloadUpdate.rawOutput ?? payloadUpdate.output ?? undefined;
            const next: ToolCall = {
              ...existing,
              ...payloadUpdate,
              toolCallId,
              content,
              rawInput:
                rawInput === undefined ? existing.rawInput : normalizeRawValue(rawInput),
              rawOutput:
                rawOutput === undefined ? existing.rawOutput : normalizeRawValue(rawOutput),
            };
            return { ...prev, [toolCallId]: next };
          });
          setFeed((prev) => {
            const already = prev.some((item) => item.type === 'tool' && item.toolCallId === toolCallId);
            if (already) return prev;
            return [...prev, { id: `tool-${toolCallId}`, type: 'tool', toolCallId }];
          });
          return;
        }
        if (updateType === 'available_commands_update') {
          const cmds = Array.isArray(update.availableCommands)
            ? update.availableCommands
            : Array.isArray(update.commands)
              ? update.commands
              : [];
          setCommands(
            cmds.map((cmd: any) => ({
              name: String(cmd.name || '').replace(/^\//, ''),
              description: cmd.description || cmd.summary,
              hint: cmd.input?.hint || cmd.inputHint,
            }))
          );
          return;
        }
      }
      if (payload.type === 'permission_request') {
        const requestId = payload.requestId as number;
        if (!requestId) return;
        uiLog('permission_request', payload);
        const toolCall = payload.params?.toolCall as ToolCall | undefined;
        const options = Array.isArray(payload.params?.options)
          ? payload.params.options.map((opt: any) => ({
              id: String(opt.optionId ?? opt.id ?? ''),
              label: String(opt.name ?? opt.label ?? opt.title ?? opt.optionId ?? 'Allow'),
              kind: opt.kind,
            }))
          : [];
        setPermissions((prev) => ({
          ...prev,
          [requestId]: { requestId, toolCall, options },
        }));
        setFeed((prev) => [...prev, { id: `perm-${requestId}`, type: 'permission', requestId }]);
      }
    });
    return () => {
      off?.();
    };
  }, [task.id, uiLog]);

  const mergeBlocks = (base: ContentBlock[], incoming: ContentBlock[]) => {
    const next = [...base];
    for (const block of incoming) {
      if (block.type === 'text') {
        const last = next[next.length - 1];
        if (last && last.type === 'text') {
          last.text = (last.text || '') + (block.text || '');
        } else {
          next.push({ ...block });
        }
      } else {
        next.push({ ...block });
      }
    }
    return next;
  };

  const normalizeRawValue = (value: any): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const normalizePromptCaps = (caps: any) => ({
    image: Boolean(caps?.image ?? caps?.images ?? caps?.supportsImage ?? caps?.supportsImages),
    audio: Boolean(caps?.audio ?? caps?.supportsAudio ?? caps?.supportsAudioInput),
    embeddedContext: Boolean(
      caps?.embeddedContext ?? caps?.embedded_context ?? caps?.supportsEmbeddedContext
    ),
  });

  const toFileUri = (filePath: string) => `file://${encodeURI(filePath)}`;

  const appendMessage = (role: 'user' | 'assistant' | 'system', blocks: ContentBlock[]) => {
    if (!blocks.length) return;
    setFeed((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === 'message' && last.role === role && last.streaming) {
        const merged = mergeBlocks(last.blocks, blocks);
        const next = [...prev];
        next[next.length - 1] = { ...last, blocks: merged };
        return next;
      }
      return [
        ...prev,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'message',
          role,
          blocks,
          streaming: role === 'assistant',
        },
      ];
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!sessionId) return;
    if (!trimmed && attachments.length === 0) return;
    setInput('');
    const promptBlocks = buildPromptBlocks(trimmed);
    appendMessage('user', promptBlocks);
    setAttachments([]);
    setIsRunning(true);
    uiLog('sendPrompt', { sessionId, blocks: promptBlocks });
    const res = await window.electronAPI.acpSendPrompt({
      sessionId,
      prompt: promptBlocks,
    });
    uiLog('sendPrompt:response', res);
    if (!res?.success) {
      setSessionError(res?.error || 'Failed to send prompt.');
      setIsRunning(false);
    }
  };

  const handleCancel = async () => {
    if (!sessionId) return;
    uiLog('cancelSession', { sessionId });
    await window.electronAPI.acpCancel({ sessionId });
    setIsRunning(false);
    setToolCalls((prev) => {
      const next: Record<string, ToolCall> = {};
      for (const [id, call] of Object.entries(prev)) {
        if (call.status && ['completed', 'failed', 'cancelled'].includes(call.status)) {
          next[id] = call;
        } else {
          next[id] = { ...call, status: 'cancelled' };
        }
      }
      return next;
    });
    const pending = Object.keys(permissions).map((id) => Number(id));
    if (pending.length) {
      await Promise.all(
        pending.map((requestId) =>
          window.electronAPI.acpRespondPermission({
            sessionId,
            requestId,
            outcome: { outcome: 'cancelled' },
          })
        )
      );
      uiLog('permission:auto-cancelled', { sessionId, pending });
      setPermissions({});
      setFeed((prev) => prev.filter((item) => item.type !== 'permission'));
    }
  };

  const handlePermissionChoice = async (requestId: number, optionId: string | null) => {
    if (!sessionId) return;
    const outcome = optionId
      ? ({ outcome: 'selected', optionId } as const)
      : ({ outcome: 'cancelled' } as const);
    uiLog('permission:choice', { sessionId, requestId, outcome });
    await window.electronAPI.acpRespondPermission({ sessionId, requestId, outcome });
    setPermissions((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    setFeed((prev) => prev.filter((item) => !(item.type === 'permission' && item.requestId === requestId)));
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      const name = file.name || 'attachment';
      const mimeType = file.type || 'application/octet-stream';
      const path = (file as any).path;
      const size = file.size;
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const isImage = mimeType.startsWith('image/');
      const isAudio = mimeType.startsWith('audio/');
      const isText =
        mimeType.startsWith('text/') ||
        /\.(md|txt|ts|tsx|js|jsx|json|yml|yaml)$/i.test(name);
      const supportsImage = Boolean(promptCaps.image);
      const supportsAudio = Boolean(promptCaps.audio);
      const supportsEmbedded = Boolean(promptCaps.embeddedContext);
      const kind: Attachment['kind'] = isImage ? 'image' : isAudio ? 'audio' : 'file';
      const attachment: Attachment = {
        id,
        name,
        path,
        mimeType,
        size,
        kind,
      };
      if (isImage && supportsImage && size <= 4 * 1024 * 1024) {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1] || '';
          attachment.data = base64;
        }
      } else if (isAudio && supportsAudio && size <= 8 * 1024 * 1024) {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1] || '';
          attachment.data = base64;
        }
      } else if (isText && supportsEmbedded && size <= 200 * 1024) {
        const text = await readFileAsText(file);
        if (text) {
          attachment.textContent = text;
        }
      }
      next.push(attachment);
    }
    if (next.length) {
      setAttachments((prev) => [...prev, ...next]);
    }
  };

  const buildPromptBlocks = (text: string): ContentBlock[] => {
    const blocks: ContentBlock[] = [];
    const supportsImage = Boolean(promptCaps.image);
    const supportsAudio = Boolean(promptCaps.audio);
    const supportsEmbedded = Boolean(promptCaps.embeddedContext);
    attachments.forEach((att) => {
      if (att.kind === 'image' && att.data && supportsImage) {
        blocks.push({ type: 'image', mimeType: att.mimeType, data: att.data });
        return;
      }
      if (att.kind === 'audio' && att.data && supportsAudio) {
        blocks.push({ type: 'audio', mimeType: att.mimeType, data: att.data });
        return;
      }
      if (att.textContent && supportsEmbedded && att.path) {
        blocks.push({
          type: 'resource',
          resource: {
            uri: toFileUri(att.path),
            mimeType: att.mimeType,
            text: att.textContent,
          },
        });
        return;
      }
      if (att.path) {
        blocks.push({
          type: 'resource_link',
          uri: toFileUri(att.path),
          name: att.name,
          title: att.name,
          mimeType: att.mimeType,
          size: att.size,
        });
      }
    });
    if (text) {
      blocks.push({ type: 'text', text });
    }
    return blocks;
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const commandSuggestions = useMemo(() => {
    if (!input.startsWith('/')) return [];
    const query = input.slice(1).toLowerCase();
    return commands
      .filter((cmd) => cmd.name && cmd.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [commands, input]);

  const commandHint = useMemo(() => {
    if (!input.startsWith('/')) return null;
    const trimmed = input.trim();
    const name = trimmed.slice(1).split(/\s+/)[0];
    if (!name) return null;
    const hasArgs = trimmed.split(/\s+/).length > 1;
    if (hasArgs) return null;
    const match = commands.find((cmd) => cmd.name.toLowerCase() === name.toLowerCase());
    return match?.hint || null;
  }, [commands, input]);

  const canSend = input.trim().length > 0 || attachments.length > 0;

  const renderContentBlocks = (blocks: ContentBlock[]) => {
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        return (
          <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">
            {block.text}
          </p>
        );
      }
      if (block.type === 'image' && block.data && block.mimeType) {
        return (
          <img
            key={index}
            src={`data:${block.mimeType};base64,${block.data}`}
            alt={block.title || 'image'}
            className="max-h-64 rounded-md border"
          />
        );
      }
      if (block.type === 'audio' && block.data && block.mimeType) {
        return (
          <audio key={index} controls className="w-full">
            <source src={`data:${block.mimeType};base64,${block.data}`} />
          </audio>
        );
      }
      if (block.type === 'resource' || block.type === 'resource_link') {
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri || '';
        const label =
          resource.title ||
          resource.name ||
          block.title ||
          block.name ||
          uri ||
          'resource';
        const previewText = (resource.text as string | undefined) || block.text;
        const isFile = uri.startsWith('file://');
        return (
          <div key={index} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="min-w-0">
              <div className="truncate">{label}</div>
              {block.type === 'resource' && previewText ? (
                <div className="mt-1 text-[11px] text-muted-foreground/80">
                  {previewText.slice(0, 200)}
                  {previewText.length > 200 ? '…' : ''}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {uri ? (
                <button
                  type="button"
                  onClick={() => {
                    if (uri.startsWith('http')) {
                      window.electronAPI.openExternal(uri);
                      return;
                    }
                    if (isFile) {
                      const filePath = decodeURIComponent(uri.replace('file://', ''));
                      window.electronAPI.openIn({ app: 'finder', path: filePath });
                    }
                  }}
                  className="text-xs text-foreground underline"
                >
                  Open
                </button>
              ) : null}
            </div>
          </div>
        );
      }
      return (
        <pre key={index} className="whitespace-pre-wrap text-xs text-muted-foreground">
          {JSON.stringify(block, null, 2)}
        </pre>
      );
    });
  };

  const renderToolCall = (toolCallId: string) => {
    const toolCall = toolCalls[toolCallId];
    if (!toolCall) return null;
    const status = toolCall.status || 'pending';
    const statusClass = statusStyles[status] || 'text-muted-foreground bg-muted/40 border-border';
    const diffContent = toolCall.content?.filter((item) => item.type === 'diff') as
      | Array<{ type: 'diff'; path?: string; oldText?: string; newText?: string; original?: string; updated?: string }>
      | undefined;
    return (
      <div key={toolCallId} className="rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">
              {toolCall.title || toolCall.kind || 'Tool call'}
            </div>
            {toolCall.kind ? <div className="text-xs text-muted-foreground">{toolCall.kind}</div> : null}
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
            {status.replace('_', ' ')}
          </span>
        </div>
        {toolCall.locations?.length ? (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {toolCall.locations.map((loc, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {loc.path}
                  {loc.line ? `:${loc.line}` : ''}
                </span>
                <button
                  type="button"
                  className="text-xs text-foreground underline"
                  onClick={() => {
                    if (!loc.path) return;
                    window.electronAPI.openIn({ app: 'finder', path: loc.path });
                  }}
                >
                  Reveal
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {toolCall.content?.length ? (
          <div className="mt-3 space-y-3 text-sm text-foreground">
            {toolCall.content.map((item, idx) => {
              if (item.type === 'content') {
                return (
                  <div key={idx} className="rounded-md border border-border bg-muted/30 p-3">
                    {renderContentBlocks([item.content])}
                  </div>
                );
              }
              if (item.type === 'diff') {
                const before = (item as any).oldText ?? (item as any).original ?? '';
                const after = (item as any).newText ?? (item as any).updated ?? '';
                return (
                  <div key={idx} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-foreground">
                      Diff {item.path ? `— ${item.path}` : ''}
                    </div>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Before
                        </div>
                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-background px-2 py-1 text-xs">
                          {before}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          After
                        </div>
                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-background px-2 py-1 text-xs">
                          {after}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              }
              if (item.type === 'terminal') {
                const output = terminalOutputs[item.terminalId] || '';
                return (
                  <div key={idx} className="rounded-md border border-border bg-black/90 p-3 text-xs text-white">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-white/70">
                      Terminal
                    </div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap">{output}</pre>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ) : null}
        {toolCall.rawInput || toolCall.rawOutput || toolCall.rawInput === '' ? (
          <details className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              Details
            </summary>
            {toolCall.rawInput ? (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Input
                </div>
                <pre className="mt-1 max-h-56 overflow-auto rounded bg-background px-2 py-1 text-xs">
                  {toolCall.rawInput}
                </pre>
              </div>
            ) : null}
            {toolCall.rawOutput ? (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Output
                </div>
                <pre className="mt-1 max-h-56 overflow-auto rounded bg-background px-2 py-1 text-xs">
                  {toolCall.rawOutput}
                </pre>
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
    );
  };

  const renderPermission = (request: PermissionRequest) => {
    const toolTitle =
      request.toolCall?.title ||
      request.toolCall?.kind ||
      (request as any).title ||
      'Permission required';
    return (
      <div key={request.requestId} className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div className="space-y-1">
            <div className="font-semibold">{toolTitle}</div>
            <div className="text-xs text-destructive/90">
              This tool call requires explicit approval.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {request.options?.length ? (
                request.options.map((option) => (
                  <Button
                    key={option.id}
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    onClick={() => handlePermissionChoice(request.requestId, option.id)}
                  >
                    {option.label}
                    {option.kind ? ` (${option.kind})` : ''}
                  </Button>
                ))
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  onClick={() => handlePermissionChoice(request.requestId, 'approve')}
                >
                  Allow
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => handlePermissionChoice(request.requestId, null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMessage = (item: Extract<FeedItem, { type: 'message' }>) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    const wrapperClass = isSystem
      ? 'flex justify-center'
      : isUser
        ? 'flex justify-end'
        : 'flex justify-start';
    const base = isSystem
      ? 'max-w-[80%] rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground'
      : isUser
        ? 'max-w-[75%] rounded-2xl border border-sky-500/40 bg-sky-600 px-4 py-3 text-white shadow-sm dark:bg-sky-500/80'
        : 'max-w-[80%] text-sm text-foreground';
    return (
      <div key={item.id} className={wrapperClass}>
        <div className={base}>
          <div className={item.streaming && !isUser ? 'shimmer-text' : ''}>
            {renderContentBlocks(item.blocks)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex h-full flex-col bg-white dark:bg-gray-900 ${className || ''}`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-6">
          <div className="mx-auto max-w-4xl space-y-2">
            {isProviderInstalled === false ? (
              <InstallBanner
                provider={provider as any}
                installCommand={getInstallCommandForProvider(provider as any)}
                onRunInstall={runInstallCommand}
                onOpenExternal={(url) => window.electronAPI.openExternal(url)}
              />
            ) : null}
          </div>
        </div>

        {plan && plan.length ? (
          <div className="px-6 pt-3">
            <div className="mx-auto max-w-4xl rounded-md border border-border bg-muted/20 p-3 text-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                onClick={() => setShowPlan((v) => !v)}
              >
                Plan
                <ChevronDown className={`h-3.5 w-3.5 transition ${showPlan ? 'rotate-180' : ''}`} />
              </button>
              {showPlan ? (
                <div className="mt-2 space-y-2">
                  {plan.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-foreground">
                      <Circle className="mt-0.5 h-3 w-3 text-muted-foreground" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{entry.content || ''}</span>
                          {entry.priority ? (
                            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {entry.priority}
                            </span>
                          ) : null}
                        </div>
                        {entry.status ? (
                          <div className="text-xs text-muted-foreground">{entry.status}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 pb-8">
            {feed.map((item) => {
              if (item.type === 'message') return renderMessage(item);
              if (item.type === 'tool') return renderToolCall(item.toolCallId);
              if (item.type === 'plan') {
                return null;
              }
              if (item.type === 'permission') {
                const request = permissions[item.requestId];
                return request ? renderPermission(request) : null;
              }
              return null;
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="bg-transparent px-6 py-4">
          <div className="mx-auto max-w-4xl space-y-3">
            {commandSuggestions.length ? (
              <div className="rounded-lg border border-border/60 bg-background/90 p-2 text-xs text-muted-foreground shadow-sm">
                {commandSuggestions.map((cmd) => (
                  <button
                    key={cmd.name}
                    type="button"
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-muted/40"
                    onClick={() => setInput(`/${cmd.name} `)}
                  >
                    <span className="font-medium text-foreground">/{cmd.name}</span>
                    {cmd.description ? (
                      <span className="text-muted-foreground">{cmd.description}</span>
                    ) : null}
                    {cmd.hint ? (
                      <span className="text-muted-foreground/70">- {cmd.hint}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="relative rounded-xl border border-border/60 bg-background/90 shadow-sm backdrop-blur-sm">
              {sessionError ? (
                <div className="absolute -top-16 left-4 right-4 z-10 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <div>
                    <div className="font-semibold">ACP session failed</div>
                    <div>{sessionError}</div>
                  </div>
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(event) => {
                  if (!event.target.files) return;
                  void handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <div className="px-4 pt-4">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask to make changes..."
                  rows={1}
                  className="w-full resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-foreground selection:bg-primary/20 placeholder:text-muted-foreground focus:outline-none"
                  style={{ minHeight: '40px', maxHeight: '200px' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer?.files?.length) {
                      void handleFiles(event.dataTransfer.files);
                    }
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  spellCheck={false}
                />
              </div>
              {attachments.length ? (
                <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="truncate">{att.name}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => removeAttachment(att.id)}
                        aria-label="Remove attachment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2.5 text-xs font-medium text-foreground shadow-sm"
                  >
                    <OpenAIIcon className="h-3.5 w-3.5" />
                    <span>Codex</span>
                  </button>
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger className="h-8 w-auto rounded-md border border-border/60 bg-background/90 px-2.5 text-xs text-foreground shadow-sm">
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5.2-codex">GPT-5.2-Codex</SelectItem>
                      <SelectItem value="gpt-5.2-mini">GPT-5.2-mini</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setPlanModeEnabled((prev) => !prev)}
                    aria-pressed={planModeEnabled}
                    title={
                      planModeEnabled
                        ? 'Plan mode: read-only'
                        : 'Full access'
                    }
                    className={`flex h-8 items-center justify-center rounded-md px-2 text-muted-foreground transition ${
                      planModeEnabled
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-background/90 hover:text-foreground'
                    }`}
                  >
                    <Clipboard className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-md bg-background/90 text-muted-foreground hover:bg-background hover:text-foreground"
                    onClick={handleAttachClick}
                    disabled={!sessionId}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    onClick={isRunning ? handleCancel : handleSend}
                    className="h-8 w-8 rounded-md"
                    disabled={!sessionId || (isRunning ? false : !canSend)}
                    variant={isRunning ? 'secondary' : 'default'}
                  >
                    {isRunning ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
            {commandHint ? (
              <div className="text-xs text-muted-foreground">
                Hint: {commandHint}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcpChatInterface;

async function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
