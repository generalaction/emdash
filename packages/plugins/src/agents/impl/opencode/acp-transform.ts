import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  NormalizedEvent,
  PlanEntryInput,
  PlanEntryPriority,
  PlanEntryStatus,
} from '@emdash/core/acp';

type OpenCodeTodo = {
  content: unknown;
  status: unknown;
  priority: unknown;
};

/** Convert OpenCode's generic `todowrite` tool calls into canonical ACP plan updates. */
export function enrichOpenCodeUpdate(update: NormalizedEvent, raw: SessionUpdate): NormalizedEvent {
  if (update.kind !== 'tool_call' && update.kind !== 'tool_update') return update;
  if (!isTodoWriteTitle(update.title)) return update;

  const entries = extractTodoEntries(raw);
  return entries !== null ? { kind: 'plan', entries } : { kind: 'ignored' };
}

function isTodoWriteTitle(title: string | null): boolean {
  return title !== null && /^(?:todowrite|\d+ todos?)$/i.test(title.trim());
}

function extractTodoEntries(raw: SessionUpdate): PlanEntryInput[] | null {
  const value = raw as unknown as { rawInput?: unknown; rawOutput?: unknown };
  const todos = readTodos(readMetadata(value.rawOutput)) ?? readTodos(value.rawInput);
  if (todos === null) return null;

  const entries: PlanEntryInput[] = [];
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object') continue;
    const value = todo as OpenCodeTodo;
    const status = readStatus(value.status);
    const priority = readPriority(value.priority);
    if (typeof value.content !== 'string' || status === null || priority === null) continue;
    entries.push({ content: value.content, status, priority });
  }
  return todos.length > 0 && entries.length === 0 ? null : entries;
}

function readTodos(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object') return null;
  const todos = (value as { todos?: unknown }).todos;
  return Array.isArray(todos) ? todos : null;
}

function readMetadata(value: unknown): unknown {
  return value && typeof value === 'object'
    ? (value as { metadata?: unknown }).metadata
    : undefined;
}

function readStatus(value: unknown): PlanEntryStatus | null {
  switch (value) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return value;
    case 'cancelled':
      return 'completed';
    default:
      return null;
  }
}

function readPriority(value: unknown): PlanEntryPriority | null {
  switch (value) {
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return null;
  }
}
