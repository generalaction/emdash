import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/runtimes/acp/api';

/**
 * Claude-specific enrichment of a baseline `NormalizedEvent`.
 *
 * The Claude ACP adapter stamps subagent child updates with
 * `_meta.claudeCode.parentToolUseId` to indicate that a tool call was produced
 * by a nested agent (Task/Agent tool). This function promotes that value to the
 * first-class `parentToolCallId` field so downstream consumers never need to
 * know about `claudeCode`.
 *
 * Provider-injected task envelopes become subagent updates when they carry an
 * explicit known status and tool identity, or passive notifications otherwise.
 * Unrecognized content remains a message for the renderer's literal fallback.
 */
export function enrichClaudeUpdate(update: NormalizedEvent, raw: SessionUpdate): NormalizedEvent {
  if (update.kind === 'message' && update.role === 'user') {
    if (update.promptId || update.attachments?.length) return update;
    const text = update.text.trim();
    const fields = parseTaskFields(text);
    const notification = fields ? taskUpdate(fields) : null;
    if (notification) {
      return {
        kind: 'subagent_update',
        agentId: notification.taskId,
        toolCallId: notification.toolUseId,
        status: notification.status,
        summary: notification.summary,
        outputFile: notification.outputFile,
      };
    }
    if (fields) {
      return {
        kind: 'notification',
        title: fields.summary || 'Background task update',
        text: [
          fields.event,
          fields.status ? `Status: ${fields.status}` : undefined,
          fields.note,
          fields.result,
          fields['output-file'] ? `Output: ${fields['output-file']}` : undefined,
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    }
    // Incomplete/unknown envelopes stay visible as literal message content.
    if (text.startsWith('<task-notification>')) return update;
    if (isLocalCommandChunk(text)) return { kind: 'ignored' };
    return update;
  }

  if (update.kind !== 'tool_call' && update.kind !== 'tool_update') return update;
  const normalizedUpdate =
    update.kind === 'tool_update' && isCommandDescriptionEcho(update, raw)
      ? withoutOutputText(update)
      : update;

  const parentToolUseId = (
    raw._meta as { claudeCode?: { parentToolUseId?: unknown } } | null | undefined
  )?.claudeCode?.parentToolUseId;

  const parentPatch =
    typeof parentToolUseId === 'string' ? { parentToolCallId: parentToolUseId } : {};
  const outputPatch =
    normalizedUpdate.outputText === undefined && rawOutputText(raw) !== undefined
      ? { outputText: rawOutputText(raw)! }
      : {};

  if (claudeToolName(raw) === 'Agent') {
    const asyncLaunch = parseAsyncLaunch(raw);
    return {
      kind: 'subagent',
      operation: normalizedUpdate.kind === 'tool_call' ? 'start' : 'update',
      toolCallId: normalizedUpdate.toolCallId,
      title: asyncLaunch?.description ?? normalizedUpdate.title ?? 'Agent',
      status: asyncLaunch ? 'in_progress' : (normalizedUpdate.status ?? null),
      parentToolCallId: parentPatch.parentToolCallId ?? normalizedUpdate.parentToolCallId,
      inputSummary: agentInputSummary(raw),
      ...(asyncLaunch ? { background: true } : {}),
      ...(asyncLaunch?.agentId !== undefined ? { agentId: asyncLaunch.agentId } : {}),
      ...(asyncLaunch?.outputFile !== undefined ? { outputFile: asyncLaunch.outputFile } : {}),
    };
  }

  if (!parentPatch.parentToolCallId && outputPatch.outputText === undefined)
    return normalizedUpdate;
  return { ...normalizedUpdate, ...parentPatch, ...outputPatch };
}

type ClaudeMeta = {
  claudeCode?: {
    parentToolUseId?: unknown;
    toolName?: unknown;
    toolResponse?: unknown;
  };
};

type AsyncLaunch = {
  agentId: string;
  outputFile?: string;
  description?: string;
};

type TaskNotification = {
  taskId: string;
  toolUseId: string;
  outputFile?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  summary?: string;
};

function claudeMeta(raw: SessionUpdate): ClaudeMeta['claudeCode'] | undefined {
  return (raw._meta as ClaudeMeta | null | undefined)?.claudeCode;
}

function claudeToolName(raw: SessionUpdate): string | null {
  const toolName = claudeMeta(raw)?.toolName;
  return typeof toolName === 'string' ? toolName : null;
}

function agentInputSummary(raw: SessionUpdate): string | undefined {
  const input = (raw as { rawInput?: { description?: unknown } }).rawInput;
  return typeof input?.description === 'string' ? input.description : undefined;
}

function isCommandDescriptionEcho(
  update: Extract<NormalizedEvent, { kind: 'tool_update' }>,
  raw: SessionUpdate
): boolean {
  if (raw.sessionUpdate !== 'tool_call_update') return false;
  const rawUpdate = raw as unknown as {
    title?: unknown;
    kind?: unknown;
    content?: unknown;
    rawInput?: { command?: unknown; description?: unknown } | null;
    rawOutput?: unknown;
  };
  const command = rawUpdate.rawInput?.command;
  const description = rawUpdate.rawInput?.description;
  return (
    rawUpdate.kind === 'execute' &&
    typeof command === 'string' &&
    typeof description === 'string' &&
    rawUpdate.title === command &&
    rawUpdate.rawOutput == null &&
    singleTextContent(rawUpdate.content) === description &&
    update.inputSummary === description &&
    update.outputText === description
  );
}

function singleTextContent(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length !== 1) return undefined;
  const block = content[0] as { type?: unknown; content?: unknown };
  if (block.type !== 'content' || !block.content || typeof block.content !== 'object')
    return undefined;
  const payload = block.content as { type?: unknown; text?: unknown };
  return payload.type === 'text' && typeof payload.text === 'string' ? payload.text : undefined;
}

function withoutOutputText(
  update: Extract<NormalizedEvent, { kind: 'tool_update' }>
): Extract<NormalizedEvent, { kind: 'tool_update' }> {
  const result = { ...update };
  delete result.outputText;
  return result;
}

function parseAsyncLaunch(raw: SessionUpdate): AsyncLaunch | null {
  const response = claudeMeta(raw)?.toolResponse as
    | {
        isAsync?: unknown;
        status?: unknown;
        agentId?: unknown;
        outputFile?: unknown;
        description?: unknown;
      }
    | null
    | undefined;
  if (
    response?.isAsync === true &&
    response.status === 'async_launched' &&
    typeof response.agentId === 'string'
  ) {
    return {
      agentId: response.agentId,
      ...(typeof response.outputFile === 'string' ? { outputFile: response.outputFile } : {}),
      ...(typeof response.description === 'string' ? { description: response.description } : {}),
    };
  }

  const text = rawText(raw);
  if (!text.includes('Async agent launched successfully.')) return null;
  const agentId = /^agentId:\s+([^\s]+)/m.exec(text)?.[1];
  if (!agentId) return null;
  const outputFile = /^output_file:\s+(.+)$/m.exec(text)?.[1]?.trim();
  return {
    agentId,
    ...(outputFile ? { outputFile } : {}),
  };
}

function rawText(raw: SessionUpdate): string {
  const parts: string[] = [];
  const content = (raw as { content?: unknown; rawOutput?: unknown }).content;
  collectText(content, parts);
  collectText((raw as { rawOutput?: unknown }).rawOutput, parts);
  return parts.join('\n');
}

function rawOutputText(raw: SessionUpdate): string | undefined {
  const rawOutput = (raw as { rawOutput?: unknown }).rawOutput;
  return typeof rawOutput === 'string' && rawOutput.length > 0 ? rawOutput : undefined;
}

function collectText(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }
  const maybeText = (value as { text?: unknown }).text;
  if (typeof maybeText === 'string') parts.push(maybeText);
  collectText((value as { content?: unknown }).content, parts);
}

function isLocalCommandChunk(text: string): boolean {
  return text.startsWith('<local-command-') || text.includes('<command-name>');
}

export function parseTaskNotification(text: string): TaskNotification | null {
  const fields = parseTaskFields(text);
  return fields ? taskUpdate(fields) : null;
}

type TaskFields = Partial<
  Record<
    'task-id' | 'tool-use-id' | 'status' | 'summary' | 'event' | 'note' | 'result' | 'output-file',
    string
  >
>;

/** Only consume a complete, standalone envelope whose fields we understand. */
function parseTaskFields(text: string): TaskFields | null {
  const body = /^<task-notification>([\s\S]*)<\/task-notification>$/.exec(text.trim())?.[1];
  if (body === undefined) return null;
  const fields: TaskFields = {};
  const pattern =
    /<(task-id|tool-use-id|status|summary|event|note|result|output-file)>([\s\S]*?)<\/\1>/g;
  let end = 0;
  for (const match of body.matchAll(pattern)) {
    const key = match[1] as keyof TaskFields;
    if (body.slice(end, match.index).trim() || fields[key] !== undefined) return null;
    fields[key] = match[2].trim();
    end = match.index + match[0].length;
  }
  if (body.slice(end).trim() || !fields['task-id']) return null;
  if (!fields.summary && !fields.event && !fields.note && !fields.result && !fields.status)
    return null;
  return fields;
}

function taskUpdate(fields: TaskFields): TaskNotification | null {
  const taskId = fields['task-id'];
  const toolUseId = fields['tool-use-id'];
  const status = toNotificationStatus(fields.status);
  if (!taskId || !toolUseId || !status || fields.event !== undefined) return null;
  return {
    taskId,
    toolUseId,
    status,
    ...(fields['output-file'] ? { outputFile: fields['output-file'] } : {}),
    ...(fields.summary ? { summary: fields.summary } : {}),
  };
}

function toNotificationStatus(status: string | undefined): TaskNotification['status'] | null {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'in_progress';
    default:
      return null;
  }
}
