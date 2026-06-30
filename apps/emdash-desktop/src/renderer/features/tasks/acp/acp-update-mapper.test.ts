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

function toolCallUpdate(toolCallId: string): AgentUpdate {
  return {
    kind: 'tool_call',
    toolCallId,
    title: 'Bash',
    toolKind: 'execute',
    status: null,
    parentToolCallId: null,
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

function diffCallUpdate(toolCallId: string, path: string): AgentUpdate {
  return {
    kind: 'tool_call',
    toolCallId,
    title: 'Edit',
    toolKind: 'edit',
    status: null,
    parentToolCallId: null,
    diffs: [{ path, oldText: 'old', newText: 'new' }],
  };
}

function diffUpdateUpdate(toolCallId: string, path: string): AgentUpdate {
  return {
    kind: 'tool_update',
    toolCallId,
    title: null,
    toolKind: null,
    status: 'completed',
    parentToolCallId: null,
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
