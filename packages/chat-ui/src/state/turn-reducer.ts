/**
 * Pure turn-reducer helpers — no Solid store dependencies.
 *
 * applyTurnEvent: immutable fold of one ActiveTurnEvent into a turn snapshot,
 *   producing a new plain ChatItem[]. Used by callers (smoother, harness) to
 *   build a snapshot that is then handed to activeTurn.set via reconcile.
 *
 * finalizeTurn: settle all in-flight streaming states (message.streaming,
 *   thinking/execute/diff/plan/resource-link status).  Called by
 *   activeTurn.commit before moving items to history.  Input must be plain
 *   objects (unwrap before passing store proxies).
 *
 * ActiveTurnEvent: the full TranscriptEvent union minus the two lifecycle
 *   terminators (turn_done / turn_cancelled), which are handled by
 *   activeTurn.commit instead.
 */

import type {
  ChatDiff,
  ChatExecute,
  ChatFileOpToolCall,
  ChatImageAttachment,
  ChatItem,
  ChatMessage,
  ChatPlan,
  ChatPlanEntry,
  ChatResourceLink,
  ChatRole,
  ChatThinking,
  ChatToolCall,
  FileOp,
  FileOpKind,
  ResourceTarget,
  ToolStatus,
} from '@/model';

// ── ActiveTurnEvent ────────────────────────────────────────────────────────────

/** All event kinds that can occur within an active turn (excludes turn_done/turn_cancelled). */
export type ActiveTurnEvent =
  | {
      type: 'message_chunk';
      id: string;
      role: ChatRole;
      text: string;
      attachments?: ChatImageAttachment[];
    }
  | { type: 'tool_start'; id: string; name: string; inputSummary?: string; parentId?: string }
  | { type: 'tool_update'; id: string; status?: ToolStatus; name?: string; inputSummary?: string }
  | { type: 'thinking_chunk'; id: string; text: string; startedAt?: number }
  | { type: 'thinking_done'; id: string; durationMs?: number }
  | { type: 'file_op_start'; id: string; op: FileOpKind; ops: FileOp[]; parentId?: string }
  | { type: 'file_op_update'; id: string; status?: ToolStatus; ops?: FileOp[] }
  | { type: 'execute_start'; id: string; command: string; startedAt?: number; parentId?: string }
  | { type: 'execute_update'; id: string; command?: string; status?: ToolStatus }
  | {
      type: 'diff_start';
      id: string;
      path: string;
      oldText: string | null;
      newText: string;
      parentId?: string;
    }
  | {
      type: 'diff_update';
      id: string;
      status?: ToolStatus;
      oldText?: string | null;
      newText?: string;
    }
  | {
      type: 'resource_link_start';
      id: string;
      uri: string;
      name: string;
      title?: string;
      description?: string;
      mimeType?: string;
      size?: number;
      target: ResourceTarget;
    }
  | { type: 'resource_link_update'; id: string; target?: ResourceTarget; status?: ToolStatus }
  | { type: 'plan_update'; id: string; entries: ChatPlanEntry[]; streaming?: boolean }
  | { type: 'plan_removed'; id: string };

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Return a new array with all in-progress thinking rows settled to 'done'.
 * Called before content events (message_chunk, tool_start, file_op_start,
 * execute_start, diff_start, plan_update) that indicate the agent has moved
 * past the reasoning phase, without a thinking_done signal.
 */
function applyFinalizeOpenThinking(turn: ChatItem[]): ChatItem[] {
  const now = Date.now();
  return turn.map((item) => {
    if (item.kind === 'thinking' && item.status === 'thinking') {
      return { ...item, status: 'done' as const, durationMs: now - item.startedAt };
    }
    return item;
  });
}

// ── applyTurnEvent ─────────────────────────────────────────────────────────────

/**
 * Apply one ActiveTurnEvent to a turn snapshot, returning a new plain ChatItem[].
 *
 * - `turn` may be null (first event in a new turn).
 * - The returned array is always a new allocation; existing items that did not
 *   change are returned by reference so downstream reconcile is O(changed).
 * - Items in the input may be plain objects OR Solid store proxies (spread works
 *   on both). The output is always plain.
 */
export function applyTurnEvent(
  turn: readonly ChatItem[] | null,
  event: ActiveTurnEvent
): ChatItem[] {
  const current = turn ? (turn as ChatItem[]) : [];

  switch (event.type) {
    case 'message_chunk': {
      const base = applyFinalizeOpenThinking(current);
      const idx = base.findIndex((it) => it.kind === 'message' && it.id === event.id);
      if (idx >= 0) {
        const msg = base[idx] as ChatMessage;
        const updated: ChatMessage = {
          ...msg,
          text: msg.text + event.text,
          attachments:
            event.attachments && event.attachments.length > 0
              ? [...(msg.attachments ?? []), ...event.attachments]
              : msg.attachments,
        };
        return base.map((it, i) => (i === idx ? updated : it));
      }
      return [
        ...base,
        {
          kind: 'message',
          id: event.id,
          role: event.role,
          text: event.text,
          streaming: true,
          attachments: event.attachments,
        } satisfies ChatMessage,
      ];
    }

    case 'tool_start': {
      const base = applyFinalizeOpenThinking(current);
      if (base.some((it) => it.kind === 'tool' && it.id === event.id)) return base;
      return [
        ...base,
        {
          kind: 'tool',
          id: event.id,
          name: event.name,
          status: 'running',
          inputSummary: event.inputSummary,
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        } satisfies ChatToolCall,
      ];
    }

    case 'tool_update': {
      const base = current.length > 0 ? current : [];
      const idx = base.findIndex((it) => it.kind === 'tool' && it.id === event.id);
      if (idx >= 0) {
        const tool = base[idx] as ChatToolCall;
        return (base as ChatItem[]).map((it, i) =>
          i === idx
            ? ({
                ...tool,
                ...(event.status !== undefined ? { status: event.status } : {}),
                ...(event.name !== undefined ? { name: event.name } : {}),
                ...(event.inputSummary !== undefined ? { inputSummary: event.inputSummary } : {}),
              } satisfies ChatToolCall)
            : it
        );
      }
      return [
        ...(base as ChatItem[]),
        {
          kind: 'tool',
          id: event.id,
          name: event.name ?? 'unknown',
          status: event.status ?? 'running',
          inputSummary: event.inputSummary,
        } satisfies ChatToolCall,
      ];
    }

    case 'thinking_chunk': {
      const idx = current.findIndex((it) => it.kind === 'thinking' && it.id === event.id);
      if (idx >= 0) {
        const th = current[idx] as ChatThinking;
        return (current as ChatItem[]).map((it, i) =>
          i === idx ? { ...th, text: th.text + event.text } : it
        );
      }
      return [
        ...(current as ChatItem[]),
        {
          kind: 'thinking',
          id: event.id,
          status: 'thinking',
          text: event.text,
          startedAt: event.startedAt ?? Date.now(),
        } satisfies ChatThinking,
      ];
    }

    case 'thinking_done': {
      const idx = current.findIndex((it) => it.kind === 'thinking' && it.id === event.id);
      if (idx < 0) return current as ChatItem[];
      const th = current[idx] as ChatThinking;
      return (current as ChatItem[]).map((it, i) =>
        i === idx
          ? ({
              ...th,
              status: 'done' as const,
              durationMs: event.durationMs ?? Date.now() - th.startedAt,
            } satisfies ChatThinking)
          : it
      );
    }

    case 'file_op_start': {
      const base = applyFinalizeOpenThinking(current);
      if (base.some((it) => it.kind === 'file-op' && it.id === event.id)) return base;
      return [
        ...base,
        {
          kind: 'file-op',
          id: event.id,
          op: event.op,
          status: 'running',
          ops: event.ops,
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        } satisfies ChatFileOpToolCall,
      ];
    }

    case 'file_op_update': {
      const idx = current.findIndex((it) => it.kind === 'file-op' && it.id === event.id);
      if (idx >= 0) {
        const fo = current[idx] as ChatFileOpToolCall;
        return (current as ChatItem[]).map((it, i) =>
          i === idx
            ? ({
                ...fo,
                ...(event.status !== undefined ? { status: event.status } : {}),
                ...(event.ops !== undefined ? { ops: event.ops } : {}),
              } satisfies ChatFileOpToolCall)
            : it
        );
      }
      return [
        ...(current as ChatItem[]),
        {
          kind: 'file-op',
          id: event.id,
          op: 'read',
          status: event.status ?? 'running',
          ops: event.ops ?? [],
        } satisfies ChatFileOpToolCall,
      ];
    }

    case 'execute_start': {
      const base = applyFinalizeOpenThinking(current);
      if (base.some((it) => it.kind === 'execute' && it.id === event.id)) return base;
      return [
        ...base,
        {
          kind: 'execute',
          id: event.id,
          command: event.command,
          status: 'running',
          startedAt: event.startedAt ?? Date.now(),
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        } satisfies ChatExecute,
      ];
    }

    case 'execute_update': {
      const idx = current.findIndex((it) => it.kind === 'execute' && it.id === event.id);
      if (idx >= 0) {
        const ex = current[idx] as ChatExecute;
        const updated: ChatExecute = {
          ...ex,
          ...(event.command !== undefined ? { command: event.command } : {}),
          ...(event.status !== undefined
            ? {
                status: event.status,
                ...(event.status === 'done' && ex.durationMs === undefined
                  ? { durationMs: Date.now() - ex.startedAt }
                  : {}),
              }
            : {}),
        };
        return (current as ChatItem[]).map((it, i) => (i === idx ? updated : it));
      }
      return [
        ...(current as ChatItem[]),
        {
          kind: 'execute',
          id: event.id,
          command: event.command ?? '',
          status: event.status ?? 'running',
          startedAt: Date.now(),
        } satisfies ChatExecute,
      ];
    }

    case 'diff_start': {
      const base = applyFinalizeOpenThinking(current);
      if (base.some((it) => it.kind === 'diff' && it.id === event.id)) return base;
      return [
        ...base,
        {
          kind: 'diff',
          id: event.id,
          path: event.path,
          oldText: event.oldText,
          newText: event.newText,
          status: 'running',
          ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        } satisfies ChatDiff,
      ];
    }

    case 'diff_update': {
      const idx = current.findIndex((it) => it.kind === 'diff' && it.id === event.id);
      if (idx < 0) return current as ChatItem[];
      const diff = current[idx] as ChatDiff;
      return (current as ChatItem[]).map((it, i) =>
        i === idx
          ? ({
              ...diff,
              ...(event.status !== undefined ? { status: event.status } : {}),
              ...(event.oldText !== undefined ? { oldText: event.oldText } : {}),
              ...(event.newText !== undefined ? { newText: event.newText } : {}),
            } satisfies ChatDiff)
          : it
      );
    }

    case 'resource_link_start': {
      if (current.some((it) => it.kind === 'resource-link' && it.id === event.id)) {
        return current as ChatItem[];
      }
      return [
        ...(current as ChatItem[]),
        {
          kind: 'resource-link',
          id: event.id,
          uri: event.uri,
          name: event.name,
          title: event.title,
          description: event.description,
          mimeType: event.mimeType,
          size: event.size,
          target: event.target,
          status: 'running',
        } satisfies ChatResourceLink,
      ];
    }

    case 'resource_link_update': {
      const idx = current.findIndex((it) => it.kind === 'resource-link' && it.id === event.id);
      if (idx < 0) return current as ChatItem[];
      const rl = current[idx] as ChatResourceLink;
      return (current as ChatItem[]).map((it, i) =>
        i === idx
          ? ({
              ...rl,
              ...(event.target !== undefined ? { target: event.target } : {}),
              ...(event.status !== undefined ? { status: event.status } : {}),
            } satisfies ChatResourceLink)
          : it
      );
    }

    case 'plan_update': {
      const base = applyFinalizeOpenThinking(current);
      const idx = base.findIndex((it) => it.kind === 'plan' && it.id === event.id);
      if (idx >= 0) {
        const plan = base[idx] as ChatPlan;
        return base.map((it, i) =>
          i === idx
            ? ({
                ...plan,
                entries: event.entries,
                ...(event.streaming !== undefined ? { streaming: event.streaming } : {}),
              } satisfies ChatPlan)
            : it
        );
      }
      return [
        ...base,
        {
          kind: 'plan',
          id: event.id,
          entries: event.entries,
          streaming: event.streaming ?? true,
        } satisfies ChatPlan,
      ];
    }

    case 'plan_removed': {
      return (current as ChatItem[]).filter((it) => !(it.kind === 'plan' && it.id === event.id));
    }
  }
}

// ── finalizeTurn ───────────────────────────────────────────────────────────────

/**
 * Produce a finalized copy of a turn snapshot, settling all in-progress states:
 *
 * - `message.streaming` → false
 * - `thinking.status === 'thinking'` → 'done' + computed durationMs
 * - `execute.status === 'running'`  → 'done' + computed durationMs
 * - `diff.status === 'running'`     → 'done'
 * - `plan.streaming`                → false
 * - `resource-link.status === 'running'` → 'done'
 *
 * Input items must be plain objects (not Solid store proxies): call
 * `unwrap(live.activeTurn) ?? []` before passing from the store.
 */
export function finalizeTurn(turn: readonly ChatItem[]): ChatItem[] {
  const now = Date.now();
  return turn.map((item): ChatItem => {
    if (item.kind === 'message' && item.streaming) {
      return { ...item, streaming: false };
    }
    if (item.kind === 'thinking' && item.status === 'thinking') {
      return { ...item, status: 'done' as const, durationMs: now - item.startedAt };
    }
    if (item.kind === 'execute' && item.status === 'running') {
      return { ...item, status: 'done' as const, durationMs: now - item.startedAt };
    }
    if (item.kind === 'diff' && item.status === 'running') {
      return { ...item, status: 'done' as const };
    }
    if (item.kind === 'plan' && item.streaming) {
      return { ...item, streaming: false };
    }
    if (item.kind === 'resource-link' && item.status === 'running') {
      return { ...item, status: 'done' as const };
    }
    return { ...item } as ChatItem;
  });
}
