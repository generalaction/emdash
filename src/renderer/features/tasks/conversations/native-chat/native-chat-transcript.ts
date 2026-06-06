import type { NativeChatEvent } from '@shared/events/nativeChatEvents';
import type { NativeChatItem, NativeChatState, NativeChatTurnStatus } from '@shared/native-chat';

/**
 * Pure transcript reduction for the native chat surface — kept free of
 * IPC imports so it can be unit-tested directly.
 */
export type NativeChatTranscript = {
  items: NativeChatItem[];
  turnStatus: NativeChatTurnStatus;
  lastError: string | null;
  /** Wall-clock duration of finished turns, keyed by turn key (e.g. "t3"). */
  turnDurationsMs: Record<string, number>;
};

export function emptyTranscript(): NativeChatTranscript {
  return { items: [], turnStatus: 'idle', lastError: null, turnDurationsMs: {} };
}

export function transcriptFromState(state: NativeChatState): NativeChatTranscript {
  return {
    items: state.items,
    turnStatus: state.turnStatus,
    lastError: state.lastError,
    turnDurationsMs: state.turnDurationsMs ?? {},
  };
}

/** Item keys are `t<seq>:<id>`; the turn key is the `t<seq>` prefix. */
export function turnKeyOf(itemKey: string): string {
  const sep = itemKey.indexOf(':');
  return sep === -1 ? itemKey : itemKey.slice(0, sep);
}

export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function upsertChatItem(items: NativeChatItem[], item: NativeChatItem): NativeChatItem[] {
  const index = items.findIndex((existing) => existing.key === item.key);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export function applyNativeChatEvent(
  transcript: NativeChatTranscript,
  event: NativeChatEvent
): NativeChatTranscript {
  switch (event.type) {
    case 'turn-started':
      return { ...transcript, turnStatus: 'running', lastError: null };
    case 'item-upsert':
      return { ...transcript, items: upsertChatItem(transcript.items, event.item) };
    case 'turn-completed':
      return {
        ...transcript,
        turnStatus: 'idle',
        turnDurationsMs: withTurnDuration(transcript.turnDurationsMs, event),
      };
    case 'turn-failed':
      return {
        ...transcript,
        turnStatus: 'idle',
        lastError: event.message,
        turnDurationsMs: withTurnDuration(transcript.turnDurationsMs, event),
      };
  }
}

function withTurnDuration(
  durations: Record<string, number>,
  event: { turnKey?: string; durationMs?: number }
): Record<string, number> {
  if (!event.turnKey || event.durationMs === undefined) return durations;
  return { ...durations, [event.turnKey]: event.durationMs };
}

/**
 * Transcript segmentation for rendering: messages and system notes stand
 * alone; consecutive work items (commands, file edits, reasoning, tool calls)
 * fold into one activity group.
 */
export type ActivityChatItem = Exclude<
  NativeChatItem,
  { kind: 'user_message' } | { kind: 'agent_message' } | { kind: 'system' }
>;

export type NativeChatSegment =
  | { type: 'item'; item: NativeChatItem }
  | { type: 'activity'; key: string; items: ActivityChatItem[] };

export function isActivityItem(item: NativeChatItem): item is ActivityChatItem {
  return item.kind !== 'user_message' && item.kind !== 'agent_message' && item.kind !== 'system';
}

export function groupChatItems(items: NativeChatItem[]): NativeChatSegment[] {
  const segments: NativeChatSegment[] = [];
  for (const item of items) {
    if (!isActivityItem(item)) {
      segments.push({ type: 'item', item });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.type === 'activity') {
      last.items.push(item);
    } else {
      segments.push({ type: 'activity', key: item.key, items: [item] });
    }
  }
  return segments;
}

/** Short header line for an activity group, e.g. "2 commands · 1 file". */
export function summarizeActivity(items: ActivityChatItem[]): string {
  let commands = 0;
  let files = 0;
  let searches = 0;
  let tools = 0;
  for (const item of items) {
    if (item.kind === 'command_execution') commands += 1;
    else if (item.kind === 'file_change') files += item.changes.length;
    else if (item.kind === 'web_search') searches += 1;
    else if (item.kind === 'mcp_tool_call') tools += 1;
  }
  const parts: string[] = [];
  if (commands) parts.push(`${commands} ${commands === 1 ? 'command' : 'commands'}`);
  if (files) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
  if (searches) parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
  if (tools) parts.push(`${tools} ${tools === 1 ? 'tool call' : 'tool calls'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Thought';
}
