import type { NormalizedEvent } from './normalized-event';

export type ToolEvent = Extract<NormalizedEvent, { parentToolCallId: string | null }>;

export interface ToolOwner {
  turnId: string;
  parentToolCallId: string | null;
}

export interface EventRoute {
  /** Null means no transcript owner can be established yet. */
  turnId: string | null;
  /** Evidence of foreground progression; independent of whether a row is inserted. */
  foreground: boolean;
  tool?: ToolEvent;
}

export function isToolEvent(event: NormalizedEvent): event is ToolEvent {
  return 'parentToolCallId' in event;
}

/**
 * Resolve ownership before opening a turn or ending content. The owner index
 * includes suppressed edit calls and survives turn completion. Provider tool ids
 * are scoped to this parser's session and the index is reset on replay/reset.
 *
 * A partial replay can contain only tool updates: recover those in an already
 * active turn, without claiming foreground progression. Idle unmatched updates
 * are retained separately until a start or parent establishes their owner.
 */
export function routeEvent(
  event: NormalizedEvent,
  owners: ReadonlyMap<string, ToolOwner>,
  activeTurnId: string | null,
  planTurnId: string | null
): EventRoute {
  if (event.kind === 'message' || event.kind === 'thinking') {
    return { turnId: activeTurnId, foreground: true };
  }
  if (event.kind === 'plan') {
    return { turnId: planTurnId ?? activeTurnId, foreground: false };
  }
  if (!isToolEvent(event)) return { turnId: null, foreground: false };

  const owner = owners.get(event.toolCallId);
  const parentToolCallId = event.parentToolCallId ?? owner?.parentToolCallId ?? null;
  const parent = parentToolCallId === null ? undefined : owners.get(parentToolCallId);
  const operation =
    event.kind === 'tool_update'
      ? 'update'
      : event.kind === 'tool_call'
        ? 'start'
        : (event.operation ?? 'start');
  const foreground = !owner && parentToolCallId === null && operation === 'start';
  return {
    turnId: owner?.turnId ?? parent?.turnId ?? activeTurnId,
    foreground,
    tool: parentToolCallId === event.parentToolCallId ? event : { ...event, parentToolCallId },
  };
}
