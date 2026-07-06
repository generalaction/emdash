import type { ChatItem, TranscriptTurn } from '@/model';

export type ActiveTurnEvent =
  | { type: 'message_chunk'; id: string; role?: 'user' | 'assistant' | 'thought'; text: string }
  | { type: 'thinking_chunk'; id: string; text: string; startedAt?: number }
  | { type: 'thinking_done'; id: string; durationMs?: number }
  | { type: 'tool_start'; id: string; name: string; inputSummary?: string; parentId?: string }
  | { type: 'tool_update'; id: string; status?: 'running' | 'done' | 'error'; name?: string; inputSummary?: string }
  | { type: 'file_op_start'; id: string; op: 'read' | 'edit' | 'delete' | 'move'; ops: Array<{ path: string }>; parentId?: string }
  | { type: 'file_op_update'; id: string; ops?: Array<{ path: string }>; status?: 'running' | 'done' | 'error' }
  | { type: 'execute_start'; id: string; command: string; startedAt?: number; parentId?: string }
  | { type: 'execute_update'; id: string; status?: 'running' | 'done' | 'error'; durationMs?: number }
  | { type: 'diff_start'; id: string; path: string; oldText: string | null; newText: string; parentId?: string }
  | { type: 'diff_update'; id: string; newText?: string; status?: 'running' | 'done' | 'error' }
  | { type: 'plan_update'; id: string; entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority: 'high' | 'medium' | 'low' }>; streaming?: boolean }
  | { type: 'plan_removed'; id: string }
  | { type: 'resource_link_start'; id: string; [key: string]: unknown }
  | { type: 'resource_link_update'; id: string; [key: string]: unknown };

// Internal compatibility helper for legacy stories/tests. The public API no
// longer exports this reducer; production code passes TranscriptTurn snapshots.
export function applyTurnEvent(
  turn: readonly ChatItem[] | TranscriptTurn | null,
  event: ActiveTurnEvent
): ChatItem[] {
  const current = turn && !Array.isArray(turn) ? (turn as TranscriptTurn).items : turn;
  const items = [...(current ?? [])] as any[];
  const idx = items.findIndex((item) => item.id === event.id);
  const existing = idx >= 0 ? items[idx] : null;
  const upsert = (item: any): ChatItem[] => {
    if (idx >= 0) items[idx] = { ...existing, ...item };
    else items.push({ ...item, seq: items.length });
    return items as ChatItem[];
  };

  switch (event.type) {
    case 'message_chunk':
      return upsert({
        kind: 'message',
        id: event.id,
        role: event.role ?? 'assistant',
        text: `${existing?.text ?? ''}${event.text}`,
        streaming: (event.role ?? 'assistant') === 'assistant',
      });
    case 'thinking_chunk':
      return upsert({
        kind: 'thinking',
        id: event.id,
        segmentId: event.id,
        status: 'thinking',
        text: `${existing?.text ?? ''}${event.text}`,
        startedAt: event.startedAt ?? existing?.startedAt ?? Date.now(),
      });
    case 'thinking_done':
      return upsert({ kind: 'thinking', id: event.id, status: 'done', durationMs: event.durationMs });
    case 'tool_start':
      return upsert({
        kind: 'tool',
        id: event.id,
        name: event.name,
        status: 'running',
        inputSummary: event.inputSummary,
        parentId: event.parentId,
      });
    case 'tool_update':
      return upsert({ ...event, kind: 'tool', id: event.id });
    case 'file_op_start':
      return upsert({
        kind: 'file-op',
        id: event.id,
        op: event.op,
        status: 'running',
        ops: event.ops,
        parentId: event.parentId,
      });
    case 'file_op_update':
      return upsert({ kind: 'file-op', id: event.id, ops: event.ops ?? existing?.ops ?? [], status: event.status ?? existing?.status ?? 'running' });
    case 'execute_start':
      return upsert({
        kind: 'execute',
        id: event.id,
        command: event.command,
        status: 'running',
        startedAt: event.startedAt ?? Date.now(),
        parentId: event.parentId,
      });
    case 'execute_update':
      return upsert({ kind: 'execute', id: event.id, status: event.status ?? existing?.status ?? 'running', durationMs: event.durationMs });
    case 'diff_start':
      return upsert({
        kind: 'diff',
        id: event.id,
        path: event.path,
        oldText: event.oldText,
        newText: event.newText,
        status: 'running',
        parentId: event.parentId,
      });
    case 'diff_update':
      return upsert({ kind: 'diff', id: event.id, newText: event.newText ?? existing?.newText ?? '', status: event.status ?? existing?.status ?? 'running' });
    case 'plan_update':
      return upsert({ kind: 'plan', id: event.id, entries: event.entries, streaming: event.streaming });
    case 'plan_removed':
      return items.filter((item) => item.id !== event.id) as ChatItem[];
    case 'resource_link_start':
    case 'resource_link_update':
      return upsert({ kind: 'resource-link', ...event });
  }
}

export function finalizeTurn(turn: readonly ChatItem[]): ChatItem[] {
  return turn.map((item: any) => {
    if (item.kind === 'message') return { ...item, streaming: false };
    if ('status' in item && item.status === 'running') return { ...item, status: 'done' };
    if (item.kind === 'plan') return { ...item, streaming: false };
    return item;
  }) as ChatItem[];
}
