import type { NativeChatItem } from '@shared/native-chat';

export type NativeChatTurnEvent =
  | { type: 'thread-started'; threadId: string }
  | { type: 'turn-started' }
  | { type: 'item'; item: NativeChatItem }
  | { type: 'turn-completed' }
  | { type: 'turn-failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ignored' };

export const IGNORED_NATIVE_CHAT_TURN_EVENT: NativeChatTurnEvent = { type: 'ignored' };

const IGNORED = IGNORED_NATIVE_CHAT_TURN_EVENT;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function itemStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  return value === 'completed' || value === 'failed' ? value : 'in_progress';
}

/**
 * Codex prints a warning into the event stream whenever a
 * `--dangerously-bypass-*` flag is passed. Emdash passes
 * `--dangerously-bypass-hook-trust` on every native turn by design (its own
 * hook config cannot be trusted interactively in non-interactive runs), so the
 * notice is expected noise, not an error the user can act on.
 */
export function isIgnorableCodexNotice(message: string): boolean {
  return message.includes('--dangerously-bypass') && message.includes('enabled');
}

/**
 * Map a thread item payload to a transcript item. `key` must be unique across
 * the whole conversation; Codex item ids restart at `item_0` every turn, so
 * callers pass a turn-scoped prefix.
 */
export function mapCodexExecItem(raw: Record<string, unknown>, key: string): NativeChatItem | null {
  const type = asString(raw.type);
  switch (type) {
    case 'agent_message':
      return { kind: 'agent_message', key, text: asString(raw.text) ?? '' };
    case 'reasoning':
      return { kind: 'reasoning', key, text: asString(raw.text) ?? '' };
    case 'command_execution':
      return {
        kind: 'command_execution',
        key,
        command: asString(raw.command) ?? '',
        aggregatedOutput: asString(raw.aggregated_output) ?? '',
        exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : null,
        status: itemStatus(raw.status),
      };
    case 'file_change': {
      const changes = Array.isArray(raw.changes)
        ? raw.changes.flatMap((change) => {
            const record = asRecord(change);
            const path = record ? asString(record.path) : undefined;
            if (!path) return [];
            return [{ path, kind: (record && asString(record.kind)) ?? 'update' }];
          })
        : [];
      return { kind: 'file_change', key, changes, status: itemStatus(raw.status) };
    }
    case 'mcp_tool_call':
      return {
        kind: 'mcp_tool_call',
        key,
        server: asString(raw.server) ?? '',
        tool: asString(raw.tool) ?? '',
        status: itemStatus(raw.status),
      };
    case 'web_search':
      return { kind: 'web_search', key, query: asString(raw.query) ?? '' };
    case 'todo_list': {
      const items = Array.isArray(raw.items)
        ? raw.items.flatMap((entry) => {
            const record = asRecord(entry);
            const text = record ? asString(record.text) : undefined;
            if (text === undefined) return [];
            return [{ text, completed: record?.completed === true }];
          })
        : [];
      return { kind: 'todo_list', key, items };
    }
    case 'error':
      return { kind: 'error', key, message: asString(raw.message) ?? 'Unknown error' };
    default:
      return null;
  }
}

/** Parse one JSONL line from `codex exec --json`. Never throws. */
export function parseCodexExecLine(line: string, itemKeyPrefix: string): NativeChatTurnEvent {
  const trimmed = line.trim();
  if (!trimmed) return IGNORED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return IGNORED;
  }
  const record = asRecord(parsed);
  if (!record) return IGNORED;

  switch (asString(record.type)) {
    case 'thread.started': {
      const threadId = asString(record.thread_id);
      return threadId ? { type: 'thread-started', threadId } : IGNORED;
    }
    case 'turn.started':
      return { type: 'turn-started' };
    case 'turn.completed':
      return { type: 'turn-completed' };
    case 'turn.failed': {
      const error = asRecord(record.error);
      const message = (error && asString(error.message)) ?? 'Codex turn failed';
      return { type: 'turn-failed', message };
    }
    case 'error':
      return { type: 'error', message: asString(record.message) ?? 'Codex reported an error' };
    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const raw = asRecord(record.item);
      if (!raw) return IGNORED;
      const id = asString(raw.id) ?? 'item';
      const item = mapCodexExecItem(raw, `${itemKeyPrefix}:${id}`);
      return item ? { type: 'item', item } : IGNORED;
    }
    default:
      return IGNORED;
  }
}

export type NativeStreamParser = {
  parseLine(line: string): NativeChatTurnEvent[];
};

type PendingTool = { item: NativeChatItem };

/** tool_result content is a string or an array of {type:'text',text} blocks. */
function claudeToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      const record = asRecord(block);
      const text = record && asString(record.text);
      return text ? [text] : [];
    })
    .join('\n');
}

const CLAUDE_FILE_TOOL_KINDS: Record<string, string> = {
  Write: 'add',
  Edit: 'update',
  MultiEdit: 'update',
  NotebookEdit: 'update',
};

export function createClaudeStreamParser(itemKeyPrefix: string): NativeStreamParser {
  let blockSeq = 0;
  const pendingTools = new Map<string, PendingTool>();

  const nextKey = () => `${itemKeyPrefix}:b${blockSeq++}`;

  function mapToolUse(block: Record<string, unknown>): NativeChatItem | null {
    const name = asString(block.name) ?? '';
    const input = asRecord(block.input) ?? {};
    const key = nextKey();

    if (name === 'Bash') {
      return {
        kind: 'command_execution',
        key,
        command: asString(input.command) ?? '',
        aggregatedOutput: '',
        exitCode: null,
        status: 'in_progress',
      };
    }
    if (name in CLAUDE_FILE_TOOL_KINDS) {
      const path = asString(input.file_path) ?? asString(input.notebook_path);
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: CLAUDE_FILE_TOOL_KINDS[name] }] : [],
        status: 'in_progress',
      };
    }
    if (name === 'WebSearch') {
      return { kind: 'web_search', key, query: asString(input.query) ?? '' };
    }
    if (name === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return {
        kind: 'todo_list',
        key,
        items: todos.flatMap((todo) => {
          const record = asRecord(todo);
          const text = record && asString(record.content);
          if (!text) return [];
          return [{ text, completed: record.status === 'completed' }];
        }),
      };
    }
    const mcpMatch = /^mcp__(.+?)__(.+)$/.exec(name);
    if (mcpMatch) {
      return {
        kind: 'mcp_tool_call',
        key,
        server: mcpMatch[1],
        tool: mcpMatch[2],
        status: 'in_progress',
      };
    }
    // Read, Glob, Grep, Task, WebFetch, Skill, ... — render as a generic tool row.
    return { kind: 'mcp_tool_call', key, server: '', tool: name, status: 'in_progress' };
  }

  function completeTool(block: Record<string, unknown>): NativeChatTurnEvent[] {
    const toolUseId = asString(block.tool_use_id);
    const pending = toolUseId ? pendingTools.get(toolUseId) : undefined;
    if (!toolUseId || !pending) return [];
    pendingTools.delete(toolUseId);

    const failed = block.is_error === true;
    const item = pending.item;
    if (item.kind === 'command_execution') {
      return [
        {
          type: 'item',
          item: {
            ...item,
            aggregatedOutput: claudeToolResultText(block.content),
            exitCode: failed ? 1 : 0,
            status: failed ? 'failed' : 'completed',
          },
        },
      ];
    }
    if (item.kind === 'file_change' || item.kind === 'mcp_tool_call') {
      return [{ type: 'item', item: { ...item, status: failed ? 'failed' : 'completed' } }];
    }
    return [];
  }

  function mapAssistantBlocks(content: unknown): NativeChatTurnEvent[] {
    if (!Array.isArray(content)) return [];
    const events: NativeChatTurnEvent[] = [];
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      switch (asString(block.type)) {
        case 'text': {
          const text = asString(block.text) ?? '';
          if (text.trim()) {
            events.push({ type: 'item', item: { kind: 'agent_message', key: nextKey(), text } });
          }
          break;
        }
        case 'thinking': {
          const text = asString(block.thinking) ?? '';
          if (text.trim()) {
            events.push({ type: 'item', item: { kind: 'reasoning', key: nextKey(), text } });
          }
          break;
        }
        case 'tool_use': {
          const item = mapToolUse(block);
          const toolUseId = asString(block.id);
          if (item) {
            if (toolUseId) pendingTools.set(toolUseId, { item });
            events.push({ type: 'item', item });
          }
          break;
        }
        default:
          break;
      }
    }
    return events;
  }

  return {
    parseLine(line: string): NativeChatTurnEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return [];
      }
      const record = asRecord(parsed);
      if (!record) return [];

      switch (asString(record.type)) {
        case 'system': {
          if (record.subtype !== 'init') return [];
          const sessionId = asString(record.session_id);
          return sessionId ? [{ type: 'thread-started', threadId: sessionId }] : [];
        }
        case 'assistant': {
          const message = asRecord(record.message);
          return message ? mapAssistantBlocks(message.content) : [];
        }
        case 'user': {
          const message = asRecord(record.message);
          const content = message?.content;
          if (!Array.isArray(content)) return [];
          return content.flatMap((rawBlock) => {
            const block = asRecord(rawBlock);
            return block && asString(block.type) === 'tool_result' ? completeTool(block) : [];
          });
        }
        case 'result': {
          if (record.is_error === true) {
            const message =
              asString(record.result) ??
              `Claude turn failed (${asString(record.subtype) ?? 'error'})`;
            return [{ type: 'turn-failed', message }];
          }
          // Final text already arrived as an assistant block; nothing to add.
          return [{ type: 'turn-completed' }];
        }
        default:
          return [];
      }
    },
  };
}

type StreamBlockKind = 'agent_message' | 'reasoning';
type StreamBlock = { key: string; kind: StreamBlockKind; text: string };

function textFromContentBlocks(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((block) => {
      const record = asRecord(block);
      const text = record && asString(record.text);
      return text ? [text] : [];
    })
    .join('\n');
}

function textFromToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return '';
  const structured = textFromContentBlocks(record.content ?? record.output ?? record.text);
  if (structured) return structured;
  return [asString(record.stdout), asString(record.stderr)].filter(Boolean).join('\n');
}

function filePathFromArgs(args: Record<string, unknown>): string | undefined {
  return (
    asString(args.path) ??
    asString(args.file) ??
    asString(args.filePath) ??
    asString(args.file_path)
  );
}

function mapPiToolStart(
  key: string,
  toolName: string,
  args: Record<string, unknown>
): NativeChatItem {
  const path = filePathFromArgs(args);
  switch (toolName) {
    case 'bash':
      return {
        kind: 'command_execution',
        key,
        command: asString(args.command) ?? '',
        aggregatedOutput: '',
        exitCode: null,
        status: 'in_progress',
      };
    case 'write':
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: 'add' }] : [],
        status: 'in_progress',
      };
    case 'edit':
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: 'update' }] : [],
        status: 'in_progress',
      };
    default:
      return { kind: 'mcp_tool_call', key, server: '', tool: toolName, status: 'in_progress' };
  }
}

function completePiToolItem(
  item: NativeChatItem,
  result: unknown,
  failed: boolean
): NativeChatItem | null {
  if (item.kind === 'command_execution') {
    const record = asRecord(result);
    const exitCode =
      typeof record?.exitCode === 'number'
        ? record.exitCode
        : typeof record?.exit_code === 'number'
          ? record.exit_code
          : failed
            ? 1
            : 0;
    return {
      ...item,
      aggregatedOutput: textFromToolResult(result),
      exitCode,
      status: failed || exitCode !== 0 ? 'failed' : 'completed',
    };
  }
  if (item.kind === 'file_change' || item.kind === 'mcp_tool_call') {
    return { ...item, status: failed ? 'failed' : 'completed' };
  }
  return null;
}

export function createPiStreamParser(itemKeyPrefix: string): NativeStreamParser {
  let blockSeq = 0;
  const streamBlocks = new Map<string, StreamBlock>();
  const pendingTools = new Map<string, PendingTool>();

  const nextKey = () => `${itemKeyPrefix}:p${blockSeq++}`;

  function blockFor(contentIndex: unknown, kind: StreamBlockKind): StreamBlock {
    const id = `${kind}:${typeof contentIndex === 'number' ? contentIndex : 0}`;
    const existing = streamBlocks.get(id);
    if (existing) return existing;
    const block = { key: nextKey(), kind, text: '' };
    streamBlocks.set(id, block);
    return block;
  }

  function mapMessageUpdate(event: Record<string, unknown>): NativeChatTurnEvent[] {
    const update = asRecord(event.assistantMessageEvent);
    if (!update) return [];
    const updateType = asString(update.type);
    const contentIndex = update.contentIndex;

    if (updateType === 'text_start') {
      blockFor(contentIndex, 'agent_message');
      return [];
    }
    if (updateType === 'thinking_start') {
      blockFor(contentIndex, 'reasoning');
      return [];
    }
    if (updateType === 'text_delta') {
      const block = blockFor(contentIndex, 'agent_message');
      block.text += asString(update.delta) ?? '';
      return block.text
        ? [{ type: 'item', item: { kind: 'agent_message', key: block.key, text: block.text } }]
        : [];
    }
    if (updateType === 'thinking_delta') {
      const block = blockFor(contentIndex, 'reasoning');
      block.text += asString(update.delta) ?? '';
      return block.text
        ? [{ type: 'item', item: { kind: 'reasoning', key: block.key, text: block.text } }]
        : [];
    }
    if (updateType === 'error') {
      return [{ type: 'turn-failed', message: asString(update.reason) ?? 'Pi turn failed' }];
    }
    return [];
  }

  return {
    parseLine(line: string): NativeChatTurnEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return [];
      }
      const record = asRecord(parsed);
      if (!record) return [];

      switch (asString(record.type)) {
        case 'session': {
          const sessionId = asString(record.id);
          return sessionId ? [{ type: 'thread-started', threadId: sessionId }] : [];
        }
        case 'turn_start':
        case 'agent_start':
          return [{ type: 'turn-started' }];
        case 'message_update':
          return mapMessageUpdate(record);
        case 'tool_execution_start': {
          const toolCallId = asString(record.toolCallId);
          const toolName = asString(record.toolName) ?? 'tool';
          const args = asRecord(record.args) ?? {};
          const key = `${itemKeyPrefix}:${toolCallId ?? `tool_${blockSeq++}`}`;
          const item = mapPiToolStart(key, toolName, args);
          if (toolCallId) pendingTools.set(toolCallId, { item });
          return [{ type: 'item', item }];
        }
        case 'tool_execution_update': {
          const toolCallId = asString(record.toolCallId);
          const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
          if (!pending || pending.item.kind !== 'command_execution') return [];
          const item = {
            ...pending.item,
            aggregatedOutput: textFromToolResult(record.partialResult),
          };
          pending.item = item;
          return [{ type: 'item', item }];
        }
        case 'tool_execution_end': {
          const toolCallId = asString(record.toolCallId);
          const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
          if (!toolCallId || !pending) return [];
          pendingTools.delete(toolCallId);
          const item = completePiToolItem(pending.item, record.result, record.isError === true);
          return item ? [{ type: 'item', item }] : [];
        }
        case 'extension_error':
          return [
            {
              type: 'item',
              item: {
                kind: 'error',
                key: nextKey(),
                message: asString(record.error) ?? 'Pi extension failed',
              },
            },
          ];
        case 'agent_end':
        case 'turn_end':
          return [{ type: 'turn-completed' }];
        case 'auto_retry_end':
          return record.success === false
            ? [{ type: 'turn-failed', message: asString(record.finalError) ?? 'Pi retry failed' }]
            : [];
        default:
          return [];
      }
    },
  };
}
