import type { CodexChatItem } from '@shared/native-chat';

/**
 * Parsed event from one JSONL line of `codex exec --json`.
 *
 * The stream emits thread events shaped like:
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{"id":"item_0","type":"command_execution",...}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 *   {"type":"turn.failed","error":{"message":"..."}}
 *
 * Unknown event and item types are ignored so newer Codex versions degrade
 * gracefully instead of breaking the transcript.
 */
export type CodexExecEvent =
  | { type: 'thread-started'; threadId: string }
  | { type: 'turn-started' }
  | { type: 'item'; item: CodexChatItem }
  | { type: 'turn-completed' }
  | { type: 'turn-failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ignored' };

const IGNORED: CodexExecEvent = { type: 'ignored' };

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
export function mapCodexExecItem(raw: Record<string, unknown>, key: string): CodexChatItem | null {
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
export function parseCodexExecLine(line: string, itemKeyPrefix: string): CodexExecEvent {
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
