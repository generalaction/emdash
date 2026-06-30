/**
 * Unit tests for acp-update-mapper.
 *
 * @emdash/chat-ui is mocked because its dist touches `document` at module
 * load time (markdown entity decoder). The mapper's correctness depends only
 * on the ids and event types it emits, not on chat-ui's internal state.
 */

import type { ActiveTurnEvent, ChatItem } from '@emdash/chat-ui';
import type { AgentUpdate, AcpTurn } from '@emdash/core/acp';
import { describe, expect, it, vi } from 'vitest';

// Minimal stubs that record id-bearing events without touching the DOM.
vi.mock('@emdash/chat-ui', () => ({
  applyTurnEvent: (items: ChatItem[], event: ActiveTurnEvent): ChatItem[] => {
    // Each event with a (possibly new) id produces a ChatItem placeholder.
    const existing = items.findIndex((i) => i.id === event.id);
    if (existing >= 0) {
      // Update in place (simulates chunk coalescing).
      const next = [...items];
      next[existing] = { ...next[existing] } as ChatItem;
      return next;
    }
    // New item — the kind mapping is approximate but sufficient for id checks.
    const kind =
      event.type === 'thinking_chunk'
        ? 'thinking'
        : event.type === 'plan_update'
          ? 'plan'
          : event.type === 'diff_start' || event.type === 'diff_update'
            ? 'diff'
            : event.type === 'tool_start' || event.type === 'tool_update'
              ? 'tool_call'
              : 'message';
    return [...items, { id: event.id, kind } as unknown as ChatItem];
  },
  finalizeTurn: (items: ChatItem[]) => items,
}));

import { foldTurn, mapAgentUpdate } from './acp-update-mapper';

// ── Helpers ────────────────────────────────────────────────────────────────────

function messageUpdate(
  role: 'user' | 'assistant',
  messageId: string | null,
  text = 'hello'
): AgentUpdate {
  return { kind: 'message', role, messageId, text };
}

function thinkingUpdate(messageId: string | null, text = 'thinking...'): AgentUpdate {
  return { kind: 'thinking', messageId, text };
}

function toolCallUpdate(toolCallId: string, parentToolCallId: string | null = null): AgentUpdate {
  return {
    kind: 'tool_call',
    toolCallId,
    title: 'Bash',
    toolKind: 'execute',
    status: null,
    parentToolCallId,
    diffs: [],
  };
}

function toolUpdateUpdate(toolCallId: string): AgentUpdate {
  return {
    kind: 'tool_update',
    toolCallId,
    title: null,
    toolKind: null,
    status: 'completed',
    parentToolCallId: null,
    diffs: [],
  };
}

function diffCallUpdate(
  toolCallId: string,
  path: string,
  parentToolCallId: string | null = null
): AgentUpdate {
  return {
    kind: 'tool_call',
    toolCallId,
    title: 'Edit',
    toolKind: 'edit',
    status: null,
    parentToolCallId,
    diffs: [{ path, oldText: 'old', newText: 'new' }],
  };
}

function diffUpdateUpdate(
  toolCallId: string,
  path: string,
  parentToolCallId: string | null = null
): AgentUpdate {
  return {
    kind: 'tool_update',
    toolCallId,
    title: null,
    toolKind: null,
    status: 'completed',
    parentToolCallId,
    diffs: [{ path, oldText: 'old', newText: 'new' }],
  };
}

function planUpdate(): AgentUpdate {
  return {
    kind: 'plan',
    entries: [{ content: 'Step 1', status: 'pending', priority: 'high' }],
  };
}

function makeTurn(id: string, updates: AgentUpdate[]): AcpTurn {
  return {
    id,
    status: 'complete',
    source: 'live',
    startSeq: 0,
    endSeq: updates.length,
    stopReason: null,
    updates: updates.map((update, seq) => ({ seq, update })),
  };
}

// ── mapAgentUpdate — id uniqueness ────────────────────────────────────────────

describe('mapAgentUpdate — id uniqueness', () => {
  it('thinking and message with the same messageId produce distinct ids', () => {
    const sharedId = 'msg_abc123';
    const thinkEvts = mapAgentUpdate(thinkingUpdate(sharedId), 'turn-1');
    const msgEvts = mapAgentUpdate(messageUpdate('assistant', sharedId), 'turn-1');

    expect(thinkEvts).toHaveLength(1);
    expect(msgEvts).toHaveLength(1);
    expect(thinkEvts[0].id).not.toBe(msgEvts[0].id);
  });

  it('thinking id contains kind prefix', () => {
    const evts = mapAgentUpdate(thinkingUpdate('msg_abc'), 'turn-1');
    expect(evts[0].id).toContain('thinking');
  });

  it('message id contains kind prefix', () => {
    const evts = mapAgentUpdate(messageUpdate('assistant', 'msg_abc'), 'turn-1');
    expect(evts[0].id).toContain('message');
  });

  it('plan ids differ across turns with different turnIds', () => {
    const evts1 = mapAgentUpdate(planUpdate(), 'turn-1');
    const evts2 = mapAgentUpdate(planUpdate(), 'turn-2');
    expect(evts1[0].id).not.toBe(evts2[0].id);
  });

  it('tool ids are scoped to turnId', () => {
    const evts1 = mapAgentUpdate(toolCallUpdate('tc-1'), 'turn-1');
    const evts2 = mapAgentUpdate(toolCallUpdate('tc-1'), 'turn-2');
    expect(evts1[0].id).not.toBe(evts2[0].id);
  });

  it('message fallback ids differ across turns', () => {
    const evts1 = mapAgentUpdate(messageUpdate('assistant', null), 'turn-1');
    const evts2 = mapAgentUpdate(messageUpdate('assistant', null), 'turn-2');
    expect(evts1[0].id).not.toBe(evts2[0].id);
  });

  it('thinking fallback ids differ across turns', () => {
    const evts1 = mapAgentUpdate(thinkingUpdate(null), 'turn-1');
    const evts2 = mapAgentUpdate(thinkingUpdate(null), 'turn-2');
    expect(evts1[0].id).not.toBe(evts2[0].id);
  });
});

// ── mapAgentUpdate — diff id stability ────────────────────────────────────────

describe('mapAgentUpdate — diff_start / diff_update id stability', () => {
  it('diff_start and matching diff_update share the same id within a turn', () => {
    const toolCallId = 'tc-edit-1';
    const path = 'src/index.ts';

    const startEvts = mapAgentUpdate(diffCallUpdate(toolCallId, path), 'turn-1');
    const updateEvts = mapAgentUpdate(diffUpdateUpdate(toolCallId, path), 'turn-1');

    const startId = startEvts.find((e) => e.type === 'diff_start')?.id;
    const updateId = updateEvts.find((e) => e.type === 'diff_update')?.id;

    expect(startId).toBeDefined();
    expect(updateId).toBeDefined();
    expect(startId).toBe(updateId);
  });

  it('diff ids are isolated between turns with the same toolCallId', () => {
    const toolCallId = 'tc-edit-1';
    const path = 'src/index.ts';

    const evts1 = mapAgentUpdate(diffCallUpdate(toolCallId, path), 'turn-1');
    const evts2 = mapAgentUpdate(diffCallUpdate(toolCallId, path), 'turn-2');

    const id1 = evts1.find((e) => e.type === 'diff_start')?.id;
    const id2 = evts2.find((e) => e.type === 'diff_start')?.id;

    expect(id1).not.toBe(id2);
  });
});

// ── mapAgentUpdate — tool_update matches tool_call id ─────────────────────────

describe('mapAgentUpdate — tool_update matches tool_call id', () => {
  it('tool_update id matches the tool_call id for the same toolCallId and turn', () => {
    const toolCallId = 'tc-2';
    const callEvts = mapAgentUpdate(toolCallUpdate(toolCallId), 'turn-1');
    const updateEvts = mapAgentUpdate(toolUpdateUpdate(toolCallId), 'turn-1');

    const callId = callEvts.find((e) => e.type === 'tool_start')?.id;
    const updateId = updateEvts.find((e) => e.type === 'tool_update')?.id;

    expect(callId).toBeDefined();
    expect(updateId).toBeDefined();
    expect(callId).toBe(updateId);
  });
});

// ── mapAgentUpdate — image attachments ────────────────────────────────────────

describe('mapAgentUpdate — image attachments', () => {
  it('a message with images produces a message_chunk with attachments', () => {
    const update: AgentUpdate = {
      kind: 'message',
      role: 'user',
      messageId: 'msg-1',
      text: 'here is an image',
      images: [{ data: 'abc123', mimeType: 'image/png', name: 'screenshot.png' }],
    };
    const evts = mapAgentUpdate(update, 'turn-1');
    expect(evts).toHaveLength(1);
    const evt = evts[0] as Extract<(typeof evts)[0], { type: 'message_chunk' }>;
    expect(evt.type).toBe('message_chunk');
    expect(evt.attachments).toHaveLength(1);
    expect(evt.attachments?.[0].dataUrl).toBe('data:image/png;base64,abc123');
    expect(evt.attachments?.[0].name).toBe('screenshot.png');
    expect(evt.attachments?.[0].id).toContain('turn-1');
  });

  it('fallback name is used when image has no name', () => {
    const update: AgentUpdate = {
      kind: 'message',
      role: 'user',
      messageId: 'msg-2',
      text: 'hi',
      images: [{ data: 'xyz', mimeType: 'image/jpeg' }],
    };
    const evts = mapAgentUpdate(update, 'turn-1');
    const evt = evts[0] as Extract<(typeof evts)[0], { type: 'message_chunk' }>;
    expect(evt.attachments?.[0].name).toBe('image-1');
    expect(evt.attachments?.[0].dataUrl).toBe('data:image/jpeg;base64,xyz');
  });

  it('an image-only message (no text) still emits a message_chunk', () => {
    const update: AgentUpdate = {
      kind: 'message',
      role: 'user',
      messageId: 'msg-3',
      text: '',
      images: [{ data: 'imgdata', mimeType: 'image/png', name: 'photo.png' }],
    };
    const evts = mapAgentUpdate(update, 'turn-1');
    expect(evts).toHaveLength(1);
    expect(evts[0].type).toBe('message_chunk');
  });

  it('a message with no images has undefined attachments', () => {
    const update: AgentUpdate = {
      kind: 'message',
      role: 'assistant',
      messageId: 'msg-4',
      text: 'plain text response',
    };
    const evts = mapAgentUpdate(update, 'turn-1');
    expect(evts).toHaveLength(1);
    const evt = evts[0] as Extract<(typeof evts)[0], { type: 'message_chunk' }>;
    expect(evt.attachments).toBeUndefined();
  });

  it('attachment ids are scoped per-image within the turn', () => {
    const update: AgentUpdate = {
      kind: 'message',
      role: 'user',
      messageId: 'msg-5',
      text: 'two images',
      images: [
        { data: 'a', mimeType: 'image/png' },
        { data: 'b', mimeType: 'image/jpeg' },
      ],
    };
    const evts = mapAgentUpdate(update, 'turn-1');
    const evt = evts[0] as Extract<(typeof evts)[0], { type: 'message_chunk' }>;
    expect(evt.attachments).toHaveLength(2);
    expect(evt.attachments?.[0].id).not.toBe(evt.attachments?.[1].id);
  });
});

// ── mapAgentUpdate — parentId scoping ────────────────────────────────────────

describe('mapAgentUpdate — parentId scoping', () => {
  const TURN = 'turn-1';
  const PARENT_RAW = 'tc-parent';
  const PARENT_SCOPED = `${TURN}:${PARENT_RAW}`;

  it('tool_call with parentToolCallId emits tool_start with scoped parentId', () => {
    const evts = mapAgentUpdate(toolCallUpdate('tc-child', PARENT_RAW), TURN);
    const start = evts.find((e) => e.type === 'tool_start') as
      | Extract<ActiveTurnEvent, { type: 'tool_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBe(PARENT_SCOPED);
  });

  it('tool_call with parentToolCallId: null emits tool_start without parentId', () => {
    const evts = mapAgentUpdate(toolCallUpdate('tc-no-parent', null), TURN);
    const start = evts.find((e) => e.type === 'tool_start') as
      | Extract<ActiveTurnEvent, { type: 'tool_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBeUndefined();
  });

  it('tool_call with diffs + parentToolCallId emits diff_start with scoped parentId', () => {
    const evts = mapAgentUpdate(diffCallUpdate('tc-edit', 'src/foo.ts', PARENT_RAW), TURN);
    const start = evts.find((e) => e.type === 'diff_start') as
      | Extract<ActiveTurnEvent, { type: 'diff_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBe(PARENT_SCOPED);
  });

  it('tool_call with diffs + parentToolCallId: null emits diff_start without parentId', () => {
    const evts = mapAgentUpdate(diffCallUpdate('tc-edit', 'src/foo.ts', null), TURN);
    const start = evts.find((e) => e.type === 'diff_start') as
      | Extract<ActiveTurnEvent, { type: 'diff_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBeUndefined();
  });

  it('tool_update with diffs + parentToolCallId emits diff_start with scoped parentId', () => {
    const evts = mapAgentUpdate(diffUpdateUpdate('tc-edit', 'src/bar.ts', PARENT_RAW), TURN);
    const start = evts.find((e) => e.type === 'diff_start') as
      | Extract<ActiveTurnEvent, { type: 'diff_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBe(PARENT_SCOPED);
  });

  it('tool_update with diffs + parentToolCallId: null emits diff_start without parentId', () => {
    const evts = mapAgentUpdate(diffUpdateUpdate('tc-edit', 'src/bar.ts', null), TURN);
    const start = evts.find((e) => e.type === 'diff_start') as
      | Extract<ActiveTurnEvent, { type: 'diff_start' }>
      | undefined;
    expect(start).toBeDefined();
    expect(start?.parentId).toBeUndefined();
  });

  it('parentId is scoped to turnId — same raw parentToolCallId across turns produces distinct parentIds', () => {
    const evts1 = mapAgentUpdate(toolCallUpdate('tc-child', PARENT_RAW), 'turn-1');
    const evts2 = mapAgentUpdate(toolCallUpdate('tc-child', PARENT_RAW), 'turn-2');
    const id1 = (evts1.find((e) => e.type === 'tool_start') as { parentId?: string })?.parentId;
    const id2 = (evts2.find((e) => e.type === 'tool_start') as { parentId?: string })?.parentId;
    expect(id1).not.toBe(id2);
  });
});

// ── foldTurn — unique ids in committed output ─────────────────────────────────

describe('foldTurn — unique ids in committed output', () => {
  it('produces no duplicate ids when thinking and message share a messageId', () => {
    const sharedMsgId = 'msg_shared';
    const turn = makeTurn('turn-1', [
      thinkingUpdate(sharedMsgId),
      messageUpdate('assistant', sharedMsgId),
    ]);
    const items = foldTurn(turn);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces no duplicate ids across two turns with plan + shared messageId', () => {
    const turn1 = makeTurn('turn-1', [
      thinkingUpdate('msg_1'),
      messageUpdate('assistant', 'msg_1'),
      planUpdate(),
    ]);
    const turn2 = makeTurn('turn-2', [
      thinkingUpdate('msg_2'),
      messageUpdate('assistant', 'msg_2'),
      planUpdate(),
    ]);
    const allItems = [...foldTurn(turn1), ...foldTurn(turn2)];
    const ids = allItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
