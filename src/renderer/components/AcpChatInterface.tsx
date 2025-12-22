import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  Circle,
  Clipboard,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Square,
  Terminal,
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

type DiffPreviewLine = { type: 'context' | 'add' | 'del'; text: string };
type DiffPreview = {
  path?: string;
  lines: DiffPreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
};

type FeedItem =
  | {
      id: string;
      type: 'message';
      role: 'user' | 'assistant' | 'system';
      blocks: ContentBlock[];
      streaming?: boolean;
      messageKind?: 'thought' | 'system';
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

const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_PREVIEW_LINES = 80;
const MAX_DIFF_SOURCE_LINES = 400;
const DEFAULT_TRUNCATE_LIMIT = 120;

const normalizeNewlines = (text: string) => text.replace(/\r\n/g, '\n');

const splitLines = (text: string) =>
  normalizeNewlines(text).split('\n');

const truncateText = (text: string, limit: number = DEFAULT_TRUNCATE_LIMIT) => {
  if (text.length <= limit) return text;
  const clipped = Math.max(0, limit - 3);
  return `${text.slice(0, clipped)}...`;
};

const pluralize = (value: number, noun: string) =>
  value === 1 ? `${value} ${noun}` : `${value} ${noun}s`;

const commonPrefixLength = (a: string[], b: string[]) => {
  const max = Math.min(a.length, b.length);
  let idx = 0;
  while (idx < max && a[idx] === b[idx]) idx += 1;
  return idx;
};

const commonSuffixLength = (a: string[], b: string[], prefix: number) => {
  let idx = 0;
  const max = Math.min(a.length, b.length) - prefix;
  while (idx < max && a[a.length - 1 - idx] === b[b.length - 1 - idx]) idx += 1;
  return idx;
};

const estimateLineChanges = (oldLines: string[], newLines: string[]) => {
  const prefix = commonPrefixLength(oldLines, newLines);
  const suffix = commonSuffixLength(oldLines, newLines, prefix);
  const deletions = Math.max(0, oldLines.length - prefix - suffix);
  const additions = Math.max(0, newLines.length - prefix - suffix);
  return { additions, deletions };
};

const myersDiff = (a: string[], b: string[]): DiffPreviewLine[] => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return buildMyersResult(trace, a, b);
      }
    }
  }
  return buildMyersResult(trace, a, b);
};

const buildMyersResult = (trace: number[][], a: string[], b: string[]): DiffPreviewLine[] => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const result: DiffPreviewLine[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      result.push({ type: 'context', text: a[x - 1] ?? '' });
      x -= 1;
      y -= 1;
    }
    if (d === 0) break;
    if (x === prevX) {
      result.push({ type: 'add', text: b[prevY] ?? '' });
    } else {
      result.push({ type: 'del', text: a[prevX] ?? '' });
    }
    x = prevX;
    y = prevY;
  }

  return result.reverse();
};

const buildFallbackDiffLines = (
  oldLines: string[],
  newLines: string[],
  context: number
): DiffPreviewLine[] => {
  const prefix = commonPrefixLength(oldLines, newLines);
  const suffix = commonSuffixLength(oldLines, newLines, prefix);
  const beforeStart = Math.max(0, prefix - context);
  const before = oldLines.slice(beforeStart, prefix);
  const afterStart = Math.max(prefix, oldLines.length - suffix);
  const afterEnd = Math.min(oldLines.length, afterStart + context);
  const after = oldLines.slice(afterStart, afterEnd);
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);

  return [
    ...before.map((text) => ({ type: 'context' as const, text })),
    ...removed.map((text) => ({ type: 'del' as const, text })),
    ...added.map((text) => ({ type: 'add' as const, text })),
    ...after.map((text) => ({ type: 'context' as const, text })),
  ];
};

const trimDiffLines = (
  lines: DiffPreviewLine[],
  maxLines: number,
  context: number
) => {
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  const changeIndexes = lines
    .map((line, idx) => (line.type === 'context' ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changeIndexes.length === 0) {
    return { lines: lines.slice(0, maxLines), truncated: true };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of changeIndexes) {
    const start = Math.max(0, idx - context);
    const end = Math.min(lines.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const total = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
  const output: DiffPreviewLine[] = [];

  if (total <= maxLines) {
    ranges.forEach((range, idx) => {
      if (idx > 0) output.push({ type: 'context', text: '...' });
      output.push(...lines.slice(range.start, range.end + 1));
    });
    return { lines: output, truncated: total < lines.length };
  }

  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first.start === last.start && first.end === last.end) {
    return { lines: lines.slice(first.start, first.end + 1), truncated: true };
  }
  const half = Math.max(4, Math.floor((maxLines - 1) / 2));
  let firstSlice = lines.slice(first.start, first.end + 1);
  let lastSlice = lines.slice(last.start, last.end + 1);
  if (firstSlice.length > half) firstSlice = firstSlice.slice(0, half);
  if (lastSlice.length > half) lastSlice = lastSlice.slice(lastSlice.length - half);
  return { lines: [...firstSlice, { type: 'context', text: '...' }, ...lastSlice], truncated: true };
};

const buildDiffPreview = (oldText: string, newText: string) => {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const useFallback = oldLines.length + newLines.length > MAX_DIFF_SOURCE_LINES * 2;
  const diffLines = useFallback
    ? buildFallbackDiffLines(oldLines, newLines, DIFF_CONTEXT_LINES)
    : myersDiff(oldLines, newLines);
  const { additions, deletions } = useFallback
    ? estimateLineChanges(oldLines, newLines)
    : diffLines.reduce(
        (acc, line) => {
          if (line.type === 'add') acc.additions += 1;
          if (line.type === 'del') acc.deletions += 1;
          return acc;
        },
        { additions: 0, deletions: 0 }
      );
  const trimmed = trimDiffLines(diffLines, MAX_DIFF_PREVIEW_LINES, DIFF_CONTEXT_LINES);
  return {
    lines: trimmed.lines,
    additions,
    deletions,
    truncated: trimmed.truncated,
  };
};

const getTailLines = (text: string, maxLines: number) => {
  const lines = splitLines(text);
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(lines.length - maxLines), truncated: true };
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
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
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

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
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
          const isThought = updateType.startsWith('thought');
          const role =
            updateType === 'agent_message_chunk' || updateType === 'agent_message'
              ? 'assistant'
              : isThought
                ? 'system'
                : 'user';
          const blocks = Array.isArray(update.content)
            ? (update.content as ContentBlock[])
            : update.content
              ? [update.content as ContentBlock]
              : [];
          appendMessage(role, blocks, {
            streaming: updateType.endsWith('_chunk'),
            messageKind: isThought ? 'thought' : role === 'system' ? 'system' : undefined,
          });
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

  const normalizePath = (value: string) => value.replace(/\\/g, '/');

  const formatPath = (value?: string) => {
    if (!value) return value;
    const normalized = normalizePath(value);
    const root = normalizePath(task.path || '');
    if (root && normalized.startsWith(root)) {
      let rel = normalized.slice(root.length);
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel || normalized.split('/').pop() || normalized;
    }
    return normalized.split('/').pop() || normalized;
  };

  const toFileUri = (filePath: string) => `file://${encodeURI(filePath)}`;

  const fromFileUri = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

  const safeJsonParse = (value?: string) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const extractPrimaryText = (blocks: ContentBlock[]) => {
    const textBlock = blocks.find((block) => block.type === 'text' && block.text);
    if (textBlock?.text) return textBlock.text;
    const resourceBlock = blocks.find(
      (block) => block.type === 'resource' && block.resource?.text
    );
    return resourceBlock?.resource?.text || '';
  };

  const appendMessage = (
    role: 'user' | 'assistant' | 'system',
    blocks: ContentBlock[],
    options?: { streaming?: boolean; messageKind?: 'thought' | 'system' }
  ) => {
    if (!blocks.length) return;
    const streaming = options?.streaming ?? role === 'assistant';
    const messageKind = options?.messageKind;
    setFeed((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.type === 'message' &&
        last.role === role &&
        last.streaming &&
        last.messageKind === messageKind
      ) {
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
          streaming,
          messageKind,
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

  const renderContentBlocks = (
    blocks: ContentBlock[],
    options?: { compact?: boolean; maxPreviewChars?: number }
  ) => {
    const isCompact = Boolean(options?.compact);
    const previewLimit = options?.maxPreviewChars ?? 200;
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        const text = block.text || '';
        const clipped = isCompact ? truncateText(text, previewLimit) : text;
        return (
          <p
            key={index}
            className={
              isCompact
                ? 'whitespace-pre-wrap text-xs text-muted-foreground'
                : 'whitespace-pre-wrap text-sm leading-relaxed'
            }
          >
            {clipped}
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
        const filePath = isFile ? fromFileUri(uri) : '';
        const displayLabel = isFile && filePath ? formatPath(filePath) || label : label;
        const displayLabelText = truncateText(displayLabel, 160);
        return (
          <div
            key={index}
            className={`flex items-center justify-between gap-2 text-xs ${
              isCompact ? 'text-muted-foreground/90' : 'text-muted-foreground'
            }`}
          >
            <div className="min-w-0">
              <div className="overflow-hidden whitespace-nowrap">{displayLabelText}</div>
              {block.type === 'resource' && previewText ? (
                <div className="mt-1 text-[11px] text-muted-foreground/80">
                  {truncateText(previewText, previewLimit)}
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

  const ActionRow: React.FC<{
    id: string;
    icon: React.ReactNode;
    label: string;
    target?: string;
    leftMeta?: React.ReactNode;
    meta?: React.ReactNode;
    status?: string;
    expanded?: boolean;
    onToggle?: () => void;
    children?: React.ReactNode;
  }> = ({ id, icon, label, target, leftMeta, meta, status, expanded, onToggle, children }) => {
    const showStatus =
      status !== undefined && ['failed', 'cancelled', 'error'].includes(status);
    const statusClass =
      status && statusStyles[status]
        ? statusStyles[status]
        : 'text-muted-foreground bg-muted/40 border-border';
    return (
      <div data-action-id={id} className="rounded-md">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="group flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/30"
        >
          <span className="relative flex h-4 w-4 items-center justify-center text-muted-foreground">
            <span className="transition-opacity group-hover:opacity-0">{icon}</span>
            <Plus className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="min-w-0 flex-1 overflow-hidden text-sm">
            <span className="font-medium text-foreground">{label}</span>
            {(target || leftMeta) ? (
              <span className="ml-2 inline-flex min-w-0 items-center gap-2 overflow-hidden text-muted-foreground">
                {target ? (
                  <span className="overflow-hidden whitespace-nowrap">{target}</span>
                ) : null}
                {leftMeta ? <span className="flex items-center gap-2">{leftMeta}</span> : null}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {meta}
            {showStatus ? (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
                {status.replace('_', ' ')}
              </span>
            ) : null}
          </span>
        </button>
        {expanded && children ? (
          <div className="px-3 pb-2 pt-1">
            <div className="inline-block max-w-full rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5">
              {children}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderDiffPreview = (diff: DiffPreview) => {
    if (!diff.lines.length) return null;
    const pathLabel = diff.path ? truncateText(diff.path, 160) : null;
    return (
      <div className="rounded-md px-1">
        {pathLabel ? (
          <div className="mb-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
            {pathLabel}
          </div>
        ) : null}
        <div className="space-y-0.5 font-mono text-xs">
          {diff.lines.map((line, idx) => {
            const style =
              line.type === 'add'
                ? 'text-emerald-700 bg-emerald-50/70 dark:text-emerald-300 dark:bg-emerald-900/30'
                : line.type === 'del'
                  ? 'text-red-700 bg-red-50/70 dark:text-red-300 dark:bg-red-900/30'
                  : 'text-muted-foreground';
            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
            return (
              <div key={idx} className={`flex gap-2 rounded px-1 ${style}`}>
                <span className="w-3 select-none">{prefix}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {line.text || ' '}
                </span>
              </div>
            );
          })}
        </div>
        {diff.truncated ? (
          <div className="mt-1 text-[11px] text-muted-foreground">Diff truncated</div>
        ) : null}
      </div>
    );
  };

  const renderToolCall = (toolCallId: string) => {
    const toolCall = toolCalls[toolCallId];
    if (!toolCall) return null;
    const status = toolCall.status || 'pending';
    const expandedKey = `tool-${toolCallId}`;
    const expanded = Boolean(expandedItems[expandedKey]);
    const kindLabel = `${toolCall.title || ''} ${toolCall.kind || ''}`.toLowerCase();
    const diffItems = (toolCall.content?.filter((item) => item.type === 'diff') ||
      []) as Array<{
      type: 'diff';
      path?: string;
      oldText?: string;
      newText?: string;
      original?: string;
      updated?: string;
    }>;
    const terminalItems =
      (toolCall.content?.filter((item) => item.type === 'terminal') as
        | Array<{ type: 'terminal'; terminalId: string }>
        | undefined) || [];
    const contentBlocks =
      (toolCall.content?.filter((item) => item.type === 'content') as
        | Array<{ type: 'content'; content: ContentBlock }>
        | undefined) || [];

    const diffPreviews: DiffPreview[] = diffItems.map((item) => {
      const before = (item as any).oldText ?? (item as any).original ?? '';
      const after = (item as any).newText ?? (item as any).updated ?? '';
      const preview = buildDiffPreview(String(before ?? ''), String(after ?? ''));
      return { ...preview, path: formatPath(item.path) };
    });

    const diffTotals = diffPreviews.reduce(
      (acc, diff) => ({
        additions: acc.additions + diff.additions,
        deletions: acc.deletions + diff.deletions,
      }),
      { additions: 0, deletions: 0 }
    );

    const parsedInput = safeJsonParse(toolCall.rawInput);
    const command = parsedInput?.command
      ? [parsedInput.command, ...(Array.isArray(parsedInput.args) ? parsedInput.args : [])].join(' ')
      : null;
    const query =
      parsedInput?.query || parsedInput?.search || parsedInput?.input || parsedInput?.prompt;

    const contentPaths = contentBlocks
      .map((item) => {
        const block = item.content;
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri;
        if (uri?.startsWith('file://')) return formatPath(fromFileUri(uri));
        return null;
      })
      .filter(Boolean) as string[];
    const locationPath = formatPath(toolCall.locations?.[0]?.path);
    const diffPath = formatPath(diffItems.find((item) => item.path)?.path);
    const rawPath = formatPath(parsedInput?.path || parsedInput?.filePath || parsedInput?.filepath);
    const primaryPath = diffPath || locationPath || contentPaths[0] || rawPath;

    const hasTerminal = terminalItems.length > 0 || Boolean(command);
    const hasDiff = diffItems.length > 0;
    const hasHttpResources = contentBlocks.some((item) => {
      const block = item.content;
      const resource = block.resource || {};
      const uri = (resource.uri as string | undefined) || block.uri || '';
      return uri.startsWith('http://') || uri.startsWith('https://');
    });

    let action = 'tool';
    if (hasDiff || /write|edit|modify|update|patch|diff/.test(kindLabel)) {
      action = 'edit';
    } else if (hasTerminal || /terminal|run|exec|command/.test(kindLabel)) {
      action = 'run';
    } else if (/read|view|open/.test(kindLabel) || primaryPath) {
      action = 'view';
    } else if (/search|browse|research|web/.test(kindLabel) || hasHttpResources) {
      action = 'research';
    }

    const icon =
      action === 'edit' ? (
        <Pencil className="h-4 w-4" />
      ) : action === 'run' ? (
        <Terminal className="h-4 w-4" />
      ) : action === 'view' ? (
        <FileText className="h-4 w-4" />
      ) : action === 'research' ? (
        <Search className="h-4 w-4" />
      ) : (
        <Sparkles className="h-4 w-4" />
      );

    const label = action === 'tool' ? toolCall.title || toolCall.kind || 'Tool' : action;
    const target =
      action === 'run'
        ? command || primaryPath
        : action === 'research'
          ? query || toolCall.title || primaryPath
          : action === 'tool'
            ? primaryPath || query
            : primaryPath || toolCall.title || toolCall.kind;
    const displayTarget = target ? truncateText(String(target), 160) : undefined;
    const leftMeta = hasDiff ? (
      <>
        <span className="text-emerald-600">+{diffTotals.additions}</span>
        <span className="text-red-600">-{diffTotals.deletions}</span>
      </>
    ) : null;

    let meta: React.ReactNode = null;
    if (action === 'view') {
      const text = extractPrimaryText(contentBlocks.map((item) => item.content));
      if (text) {
        const count = splitLines(text).length;
        meta = <span>{count} lines</span>;
      }
    } else if (action === 'research') {
      const sources = contentBlocks.filter((item) => {
        const block = item.content;
        const resource = block.resource || {};
        const uri = (resource.uri as string | undefined) || block.uri || '';
        return uri.startsWith('http://') || uri.startsWith('https://');
      }).length;
      if (sources) meta = <span>{sources} sources</span>;
    }

    return (
      <ActionRow
        key={expandedKey}
        id={expandedKey}
        icon={icon}
        label={label}
        target={displayTarget}
        leftMeta={leftMeta}
        meta={meta}
        status={status}
        expanded={expanded}
        onToggle={() => toggleExpanded(expandedKey)}
      >
        <div className="space-y-2 text-sm text-foreground">
          {diffPreviews.length ? (
            <div className="space-y-2">
              {diffPreviews.map((diff, idx) => (
                <div key={`${diff.path || 'diff'}-${idx}`}>{renderDiffPreview(diff)}</div>
              ))}
            </div>
          ) : null}
          {contentBlocks.length ? (
            <div className="space-y-2">
              {contentBlocks.map((item, idx) => (
                <div key={idx}>{renderContentBlocks([item.content], { compact: true, maxPreviewChars: 280 })}</div>
              ))}
            </div>
          ) : null}
          {terminalItems.length ? (
            <div className="space-y-2">
              {terminalItems.map((item, idx) => {
                const output = terminalOutputs[item.terminalId] || '';
                const tail = getTailLines(output, 60);
                return (
                  <div
                    key={`${item.terminalId}-${idx}`}
                    className="rounded-md bg-black/90 px-3 py-2 text-xs text-white"
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-white/60">
                      Terminal output
                    </div>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">
                      {tail.lines.join('\n')}
                    </pre>
                    {tail.truncated ? (
                      <div className="mt-1 text-[11px] text-white/60">Output truncated</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </ActionRow>
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

  const renderToolThoughtGroup = (
    groupId: string,
    buffer: FeedItem[],
    expanded: boolean
  ) => {
    const toolCount = buffer.filter((item) => item.type === 'tool').length;
    const thoughtCount = buffer.filter(
      (item) => item.type === 'message' && item.messageKind === 'thought'
    ).length;
    if (!toolCount && !thoughtCount) return null;
    const parts: string[] = [];
    if (toolCount) parts.push(pluralize(toolCount, 'tool call'));
    if (thoughtCount) parts.push(pluralize(thoughtCount, 'thought'));
    return (
      <div key={groupId} className="rounded-md">
        <button
          type="button"
          onClick={() => toggleExpanded(groupId)}
          aria-expanded={expanded}
          className="group flex items-center gap-2 rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span>{parts.join(', ')}</span>
        </button>
        {expanded ? (
          <div className="mt-1 space-y-2">
            {buffer.map((item) => {
              if (item.type === 'tool') return renderToolCall(item.toolCallId);
              if (item.type === 'message' && item.messageKind === 'thought') {
                return renderThoughtMessage(item);
              }
              return null;
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderThoughtMessage = (item: Extract<FeedItem, { type: 'message' }>) => {
    const expandedKey = `thought-${item.id}`;
    const expanded = Boolean(expandedItems[expandedKey]);
    const text = extractPrimaryText(item.blocks).trim();
    const summary = text ? truncateText(text.split('\n')[0], 120) : 'Thinking...';
    return (
      <ActionRow
        key={expandedKey}
        id={expandedKey}
        icon={<Brain className="h-4 w-4" />}
        label="thinking"
        target={summary}
        expanded={expanded}
        onToggle={() => toggleExpanded(expandedKey)}
      >
        <div className={item.streaming ? 'shimmer-text' : ''}>
          {renderContentBlocks(item.blocks, { compact: true, maxPreviewChars: 800 })}
        </div>
      </ActionRow>
    );
  };

  const renderMessage = (item: Extract<FeedItem, { type: 'message' }>) => {
    if (item.messageKind === 'thought') {
      return renderThoughtMessage(item);
    }
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
            {(() => {
              const rendered: React.ReactNode[] = [];
              let buffer: FeedItem[] = [];

              const flushInline = () => {
                if (!buffer.length) return;
                buffer.forEach((item) => {
                  if (item.type === 'tool') rendered.push(renderToolCall(item.toolCallId));
                  if (item.type === 'message' && item.messageKind === 'thought') {
                    rendered.push(renderThoughtMessage(item));
                  }
                });
                buffer = [];
              };

              const canCollapseBuffer = (
                assistantItem: Extract<FeedItem, { type: 'message' }>
              ) => {
                if (!buffer.length) return false;
                if (assistantItem.streaming) return false;
                for (const item of buffer) {
                  if (item.type === 'tool') {
                    const status = toolCalls[item.toolCallId]?.status;
                    if (!status || !['completed', 'failed', 'cancelled'].includes(status)) {
                      return false;
                    }
                  }
                  if (item.type === 'message' && item.messageKind === 'thought') {
                    if (item.streaming) return false;
                  }
                }
                return true;
              };

              feed.forEach((item) => {
                if (
                  (item.type === 'tool') ||
                  (item.type === 'message' && item.messageKind === 'thought')
                ) {
                  buffer.push(item);
                  return;
                }

                if (item.type === 'message' && item.role === 'assistant') {
                  const shouldCollapse = canCollapseBuffer(item);
                  if (!shouldCollapse) {
                    flushInline();
                  }
                  rendered.push(renderMessage(item));
                  if (shouldCollapse) {
                    const groupId = `tools-${item.id}`;
                    const expanded = Boolean(expandedItems[groupId]);
                    rendered.push(renderToolThoughtGroup(groupId, buffer, expanded));
                    buffer = [];
                  }
                  return;
                }

                flushInline();

                if (item.type === 'message') {
                  rendered.push(renderMessage(item));
                  return;
                }
                if (item.type === 'permission') {
                  const request = permissions[item.requestId];
                  rendered.push(request ? renderPermission(request) : null);
                  return;
                }
              });

              flushInline();
              return rendered;
            })()}
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
                <div className="absolute -top-16 left-4 right-4 z-10 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/95 px-3 py-2 text-xs text-destructive-foreground shadow-sm">
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
                        : 'bg-background/90 hover:bg-muted/40 hover:text-foreground'
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
