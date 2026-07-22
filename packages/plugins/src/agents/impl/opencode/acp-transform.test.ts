import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpTranscriptParser, type NormalizedEvent } from '@emdash/core/acp';
import { describe, expect, it } from 'vitest';
import { enrichOpenCodeUpdate } from './acp-transform';

const pendingTodos = [
  { content: 'Investigate todo rendering', status: 'in_progress', priority: 'high' },
];
const completedTodos = [
  { content: 'Investigate todo rendering', status: 'completed', priority: 'high' },
];

function makeToolCall(): Extract<NormalizedEvent, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId: 'todo-1',
    title: 'todowrite',
    toolKind: 'other',
    status: 'in_progress',
    parentToolCallId: null,
    diffs: [],
  };
}

function makeRaw(overrides: Record<string, unknown> = {}): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    sessionId: 'session-1',
    toolCallId: 'todo-1',
    title: 'todowrite',
    kind: 'other',
    status: 'in_progress',
    ...overrides,
  } as unknown as SessionUpdate;
}

describe('enrichOpenCodeUpdate', () => {
  it('converts todowrite raw input into a canonical plan update', () => {
    expect(
      enrichOpenCodeUpdate(makeToolCall(), makeRaw({ rawInput: { todos: pendingTodos } }))
    ).toEqual({
      kind: 'plan',
      entries: pendingTodos,
    });
  });

  it('uses completed tool metadata and maps cancelled todos to completed', () => {
    const update: NormalizedEvent = {
      ...makeToolCall(),
      kind: 'tool_update',
      title: '0 todos',
      toolKind: null,
      status: 'completed',
    };
    const raw = makeRaw({
      sessionUpdate: 'tool_call_update',
      title: '0 todos',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [
            ...completedTodos,
            { content: 'Discarded task', status: 'cancelled', priority: 'low' },
          ],
        },
      },
    });

    expect(enrichOpenCodeUpdate(update, raw)).toEqual({
      kind: 'plan',
      entries: [
        ...completedTodos,
        { content: 'Discarded task', status: 'completed', priority: 'low' },
      ],
    });
  });

  it('preserves unrelated tool calls and suppresses todo phases without entries', () => {
    const update: NormalizedEvent = {
      ...makeToolCall(),
      title: 'Run command',
    };
    expect(enrichOpenCodeUpdate(update, makeRaw({ title: 'Run command' }))).toBe(update);
    expect(enrichOpenCodeUpdate(makeToolCall(), makeRaw())).toEqual({ kind: 'ignored' });
    expect(
      enrichOpenCodeUpdate(
        { ...makeToolCall(), kind: 'tool_update', title: '1 todos' },
        makeRaw({ rawInput: { todos: [{ content: 'invalid' }] } })
      )
    ).toEqual({ kind: 'ignored' });
  });

  it('folds repeated todowrite calls into one plan row instead of generic tool rows', () => {
    const parser = new AcpTranscriptParser({
      conversationId: 'conversation-1',
      enrich: enrichOpenCodeUpdate,
    });
    parser.push(
      makeRaw({
        rawInput: { todos: pendingTodos },
      })
    );
    parser.push(
      makeRaw({
        toolCallId: 'todo-2',
        rawInput: { todos: completedTodos },
      })
    );
    parser.push(
      makeRaw({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'todo-2',
        title: '0 todos',
        status: 'completed',
        rawOutput: { metadata: { todos: completedTodos } },
      })
    );

    expect(parser.activeTurn?.items).toEqual([
      expect.objectContaining({ kind: 'create-plan-tool-call', status: 'done' }),
    ]);
    expect(parser.plan?.entries).toEqual([
      expect.objectContaining({
        content: 'Investigate todo rendering',
        status: 'completed',
        priority: 'high',
      }),
    ]);
  });
});
