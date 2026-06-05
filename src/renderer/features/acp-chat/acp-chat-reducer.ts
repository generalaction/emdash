import type { AcpPermissionRequest, AcpSessionEvent, AcpSessionStatus } from '@shared/acp';

export type AcpChatTimelineItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'plan'; entries: string[] }
  | {
      id: string;
      kind: 'tool';
      toolCallId: string;
      title: string;
      status: string;
      toolKind?: string;
    }
  | { id: string; kind: 'permission'; request: AcpPermissionRequest }
  | { id: string; kind: 'error'; message: string };

export type AcpChatState = {
  status: AcpSessionStatus;
  acpSessionId?: string;
  items: AcpChatTimelineItem[];
};

export type AcpChatAction =
  | { type: 'event'; event: AcpSessionEvent }
  | { type: 'replay'; events: AcpSessionEvent[] }
  | { type: 'user_submitted'; text: string }
  | { type: 'local_error'; message: string };

export function createInitialAcpChatState(): AcpChatState {
  return {
    status: 'starting',
    items: [],
  };
}

export function acpChatReducer(state: AcpChatState, action: AcpChatAction): AcpChatState {
  if (action.type === 'replay') {
    return action.events.reduce(
      (current, event) => applyAcpEvent(current, event),
      createInitialAcpChatState()
    );
  }

  if (action.type === 'user_submitted') {
    return appendItem(state, {
      id: `user-${Date.now()}-${state.items.length}`,
      kind: 'user',
      text: action.text,
    });
  }

  if (action.type === 'local_error') {
    return appendItem(state, {
      id: `error-${Date.now()}-${state.items.length}`,
      kind: 'error',
      message: action.message,
    });
  }

  return applyAcpEvent(state, action.event);
}

function applyAcpEvent(state: AcpChatState, event: AcpSessionEvent): AcpChatState {
  if (event.type === 'status') {
    return {
      ...state,
      status: event.status,
      ...(event.status === 'error' && event.message
        ? {
            items: [
              ...state.items,
              {
                id: `error-${Date.now()}-${state.items.length}`,
                kind: 'error',
                message: event.message,
              },
            ],
          }
        : {}),
    };
  }
  if (event.type === 'session') {
    return {
      ...state,
      acpSessionId: event.acpSessionId,
      status: 'ready',
    };
  }
  if (event.type === 'permission_request') {
    return appendItem(state, {
      id: `permission-${event.request.requestId}`,
      kind: 'permission',
      request: event.request,
    });
  }
  if (event.type === 'permission_resolved') {
    return {
      ...state,
      items: state.items.filter(
        (item) => item.kind !== 'permission' || item.request.requestId !== event.requestId
      ),
    };
  }
  if (event.type === 'diagnostic' && event.message.trim()) {
    return appendItem(state, {
      id: `error-${Date.now()}-${state.items.length}`,
      kind: 'error',
      message: event.message,
    });
  }
  if (event.type !== 'update') return state;

  const update = event.update;
  if (update.sessionUpdate === 'user_message_chunk') {
    const text = readTextContent(update.content);
    if (!text) return state;
    return appendUserText(state, text);
  }
  if (update.sessionUpdate === 'agent_message_chunk') {
    const text = readTextContent(update.content);
    if (!text) return state;
    return appendAssistantText(state, text);
  }
  if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
    return appendItem(state, {
      id: `plan-${state.items.length}`,
      kind: 'plan',
      entries: update.entries.flatMap((entry) => {
        if (typeof entry === 'object' && entry && 'content' in entry) {
          const content = (entry as { content?: unknown }).content;
          return typeof content === 'string' ? [content] : [];
        }
        return [];
      }),
    });
  }
  if (update.sessionUpdate === 'tool_call' && typeof update.toolCallId === 'string') {
    return appendItem(state, {
      id: `tool-${update.toolCallId}`,
      kind: 'tool',
      toolCallId: update.toolCallId,
      title: typeof update.title === 'string' ? update.title : 'Tool call',
      status: typeof update.status === 'string' ? update.status : 'pending',
      toolKind: typeof update.kind === 'string' ? update.kind : undefined,
    });
  }
  if (update.sessionUpdate === 'tool_call_update' && typeof update.toolCallId === 'string') {
    return {
      ...state,
      items: state.items.map((item) =>
        item.kind === 'tool' && item.toolCallId === update.toolCallId
          ? { ...item, status: typeof update.status === 'string' ? update.status : item.status }
          : item
      ),
    };
  }

  return state;
}

function appendUserText(state: AcpChatState, text: string): AcpChatState {
  const last = state.items[state.items.length - 1];
  if (last?.kind === 'user') {
    return {
      ...state,
      items: [...state.items.slice(0, -1), { ...last, text: `${last.text}${text}` }],
    };
  }
  return appendItem(state, {
    id: `user-${state.items.length}`,
    kind: 'user',
    text,
  });
}

function appendAssistantText(state: AcpChatState, text: string): AcpChatState {
  const last = state.items[state.items.length - 1];
  if (last?.kind === 'assistant') {
    return {
      ...state,
      items: [...state.items.slice(0, -1), { ...last, text: `${last.text}${text}` }],
    };
  }
  return appendItem(state, {
    id: `assistant-${state.items.length}`,
    kind: 'assistant',
    text,
  });
}

function appendItem(state: AcpChatState, item: AcpChatTimelineItem): AcpChatState {
  return {
    ...state,
    items: [...state.items, item],
  };
}

function readTextContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const candidate = content as { type?: unknown; text?: unknown };
  return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : null;
}
