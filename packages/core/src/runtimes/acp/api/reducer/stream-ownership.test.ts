import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { TranscriptItem, ToolNode } from '../models/turns';
import type { NormalizedEvent } from './normalized-event';
import { AcpTranscriptParser } from './parser';

const text = (value: string, messageId: string | null = null): NormalizedEvent => ({
  kind: 'message',
  role: 'assistant',
  messageId,
  text: value,
});
const thought = (value: string, messageId: string | null = null): NormalizedEvent => ({
  kind: 'thinking',
  messageId,
  text: value,
});
const tool = (toolCallId = 'tool', parentToolCallId: string | null = null): NormalizedEvent => ({
  kind: 'tool_call',
  toolCallId,
  parentToolCallId,
  title: 'Run',
  toolKind: 'execute',
  status: 'in_progress',
  diffs: [],
  locations: [],
});
const update = (toolCallId = 'tool'): NormalizedEvent => ({
  kind: 'tool_update',
  toolCallId,
  parentToolCallId: null,
  status: 'completed',
});
const plan: NormalizedEvent = {
  kind: 'plan',
  entries: [{ content: 'Check', priority: 'medium', status: 'in_progress' }],
};
const parser = () => new AcpTranscriptParser({ conversationId: 'stream' });
function flatten(items: readonly (TranscriptItem | ToolNode)[]): (TranscriptItem | ToolNode)[] {
  return items.flatMap((item) => [
    item,
    ...('children' in item ? flatten(item.children ?? []) : []),
  ]);
}
const messages = (p: AcpTranscriptParser) =>
  p.activeTurn?.items.filter((item) => item.kind === 'message') ?? [];

describe('content ownership across asynchronous events', () => {
  const updates: [string, NormalizedEvent][] = [
    ['status', update()],
    [
      'output',
      {
        ...update(),
        kind: 'tool_update',
        toolCallId: 'tool',
        parentToolCallId: null,
        outputText: 'output',
      },
    ],
    ['empty patch', { kind: 'tool_update', toolCallId: 'tool', parentToolCallId: null }],
    ['plan', plan],
    ['nested invocation', tool('child', 'tool')],
    ['repeated invocation', tool()],
  ];
  it.each(updates)('preserves text and identity across %s at every delta boundary', (_, event) => {
    const source = 'The registry still shows `/tmp/path` and **bold**.';
    for (let split = 1; split < source.length; split++) {
      const p = parser();
      p.pushEvent(tool(), 0);
      p.pushEvent(text(source.slice(0, split)), 10);
      const id = messages(p)[0].id;
      p.pushEvent(event, 20);
      p.pushEvent(text(source.slice(split)), 30);
      expect(messages(p)).toMatchObject([{ id, text: source }]);
      expect(messages(p)).toHaveLength(1);
    }
  });

  it.each([null, 'provider-reasoning'])('preserves reasoning lifetime with id %s', (messageId) => {
    const p = parser();
    p.pushEvent(tool(), 0);
    p.pushEvent(thought('Analy', messageId), 100);
    p.pushEvent(update(), 200);
    p.pushEvent(plan, 250);
    p.pushEvent(tool('child', 'tool'), 275);
    p.pushEvent(thought('zing', messageId), 300);
    expect(p.activeTurn?.items.filter((item) => item.kind === 'thinking')).toMatchObject([
      { text: 'Analyzing', status: 'thinking', startedAt: 100 },
    ]);
    p.endTurn(500);
    expect(p.history[0].items.filter((item) => item.kind === 'thinking')).toMatchObject([
      { text: 'Analyzing', status: 'done', durationMs: 400 },
    ]);
  });

  it('separates foreground calls and finalizes reasoning on a real content transition', () => {
    const p = parser();
    p.pushEvent(thought('first', 'r'), 0);
    p.pushEvent(tool(), 10);
    p.pushEvent(thought('second', 'r'), 20);
    p.pushEvent(text('before'), 30);
    p.pushEvent(tool('next'), 40);
    p.pushEvent(text('after'), 50);
    expect(messages(p).map((item) => item.text)).toEqual(['before', 'after']);
    expect(p.activeTurn?.items.filter((item) => item.kind === 'thinking')).toMatchObject([
      { text: 'first', status: 'done', durationMs: 10 },
      { text: 'second', status: 'done', durationMs: 10 },
    ]);
  });

  it('does not split an idless user prompt on a plan update', () => {
    const p = parser();
    p.pushEvent({ kind: 'message', role: 'user', messageId: null, text: 'hel' }, 0);
    p.pushEvent(plan, 10);
    p.pushEvent({ kind: 'message', role: 'user', messageId: null, text: 'lo' }, 20);
    expect(p.history).toHaveLength(0);
    expect(messages(p).map((item) => item.text)).toEqual(['hello']);
  });

  it('keeps provider ids opaque and separate from generated ids and roles', () => {
    const p = parser();
    p.pushEvent({ kind: 'message', role: 'user', messageId: 'same', text: 'user' });
    p.pushEvent(text('assistant', 'same'));
    p.pushEvent(text('generated'));
    p.pushEvent(text('provider', 'auto:assistant:0'));
    expect(messages(p).map((item) => [item.role, item.text])).toEqual([
      ['user', 'user'],
      ['assistant', 'assistant'],
      ['assistant', 'generated'],
      ['assistant', 'provider'],
    ]);
    expect(new Set(messages(p).map((item) => item.id)).size).toBe(4);
  });

  it('does not interpret a provider reasoning id as a generated suffix', () => {
    const p = parser();
    p.pushEvent(thought('one', 'r:segment:1'), 0);
    p.pushEvent(thought('two', 'r'), 10);
    p.pushEvent(text('answer'), 20);
    p.pushEvent(thought('three', 'r'), 30);
    p.pushEvent(thought('four', 'auto:thinking:0'), 40);
    p.pushEvent(thought('five'), 50);
    const rows = p.activeTurn?.items.filter((item) => item.kind === 'thinking') ?? [];
    expect(rows.map((item) => item.text)).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(new Set(rows.map((item) => item.id)).size).toBe(5);
  });

  it('routes late tool and child updates to their original turn', () => {
    const p = parser();
    p.pushEvent(tool(), 0);
    p.endTurn(10);
    p.pushEvent(update(), 20);
    expect(p.activeTurn).toBeNull();
    p.pushEvent({ kind: 'message', role: 'user', messageId: 'u2', text: 'next' }, 30);
    p.pushEvent(text('hel'), 40);
    p.pushEvent(tool('child', 'tool'), 50);
    p.pushEvent(
      {
        kind: 'tool_update',
        toolCallId: 'tool',
        parentToolCallId: null,
        outputText: 'late output',
      },
      60
    );
    p.pushEvent(text('lo'), 70);
    expect(messages(p).map((item) => item.text)).toEqual(['next', 'hello']);
    expect(flatten(p.history[0].items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'tool', outputText: 'late output' }),
        expect.objectContaining({ toolCallId: 'child', parentToolCallId: 'tool' }),
      ])
    );
    expect(flatten(p.activeTurn?.items ?? []).some((item) => 'toolCallId' in item)).toBe(false);
  });

  it('retains an unmatched idle update until the call is introduced', () => {
    const p = parser();
    p.pushEvent(update(), 0);
    expect(p.activeTurn).toBeNull();
    p.pushEvent(tool(), 10);
    expect(flatten(p.activeTurn?.items ?? [])).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolCallId: 'tool', status: 'done' })])
    );
  });

  it('recovers child ownership when its parent arrives after the child', () => {
    const p = parser();
    p.pushEvent(tool('child', 'parent'), 0);
    p.pushEvent(update('child'), 10);
    expect(p.activeTurn).toBeNull();
    p.pushEvent(tool('parent'), 20);
    expect(flatten(p.activeTurn?.items ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'child',
          parentToolCallId: 'parent',
          status: 'done',
        }),
      ])
    );
  });

  it('bounds unmatched idle updates and resets ownership between replays', () => {
    const p = parser();
    for (let i = 0; i < 130; i++) p.pushEvent(update(`orphan-${i}`), i);
    p.pushEvent(tool('orphan-0'), 200);
    expect(flatten(p.activeTurn?.items ?? [])[0]).toMatchObject({ status: 'running' });
    p.pushEvent(tool('orphan-129'), 201);
    expect(flatten(p.activeTurn?.items ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'orphan-129', status: 'done' }),
      ])
    );
    p.beginReplay();
    p.pushEvent(update('orphan-129'));
    expect(p.history).toHaveLength(0);
    expect(p.activeTurn).toBeNull();
    expect(p.historyRevision).toBe(0);
  });

  it('keeps background status independent of foreground completion', () => {
    const p = parser();
    p.pushEvent(
      {
        kind: 'subagent',
        operation: 'start',
        toolCallId: 'agent-tool',
        agentId: 'agent',
        parentToolCallId: null,
        title: 'Investigate',
        status: 'in_progress',
        background: true,
      },
      0
    );
    p.pushEvent(tool('child', 'agent-tool'), 10);
    p.endTurn(20);
    expect(
      flatten(p.history[0].items)
        .filter((item) => 'toolCallId' in item)
        .map((item) => item.status)
    ).toEqual(['running', 'running']);
    p.pushEvent({ kind: 'subagent_update', agentId: 'agent', status: 'completed' }, 30);
    expect(p.activeTurn).toBeNull();
    expect(p.agents[0]).toMatchObject({
      agentId: 'agent',
      toolCallId: 'agent-tool',
      status: 'completed',
      launchTurnId: p.history[0].id,
    });
    expect(p.history[0].items[0]).toMatchObject({ status: 'done' });
    expect(p.historyRevision).toBe(1);
  });

  it('applies pending subagent state to both its row and registry', () => {
    const p = parser();
    p.pushEvent(
      {
        kind: 'subagent',
        operation: 'update',
        toolCallId: 'agent-tool',
        agentId: 'agent',
        parentToolCallId: null,
        title: 'Investigate',
        status: 'completed',
        background: true,
      },
      0
    );
    p.pushEvent(
      {
        kind: 'subagent',
        operation: 'start',
        toolCallId: 'agent-tool',
        parentToolCallId: null,
        title: 'Investigate',
        status: 'in_progress',
      },
      10
    );
    expect(p.agents[0]).toMatchObject({
      agentId: 'agent',
      status: 'completed',
      launchTurnId: p.activeTurn?.id,
    });
    expect(p.activeTurn?.items[0]).toMatchObject({
      status: 'done',
      background: true,
      agentId: 'agent',
    });
  });

  it('updates a session plan while idle without starting another turn', () => {
    const p = parser();
    p.pushEvent(text('work'), 0);
    p.pushEvent(plan, 10);
    p.endTurn(20);
    p.pushEvent({ kind: 'plan', entries: [] }, 30);
    expect(p.activeTurn).toBeNull();
    expect(p.history).toHaveLength(1);
    expect(p.plan?.entries).toEqual([]);
    expect(p.history[0].items.find((item) => item.kind === 'create-plan-tool-call')).toMatchObject({
      status: 'done',
    });
  });

  it('produces identical identities and content during live streaming and replay', () => {
    const updates: SessionUpdate[] = [
      { sessionUpdate: 'tool_call', toolCallId: 'tool', title: 'Run', kind: 'execute' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hel' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } },
    ];
    const p = parser();
    updates.forEach((event, at) => p.push(event, at));
    p.endTurn(updates.length);
    const replay = AcpTranscriptParser.replay(updates, { conversationId: 'stream' });
    expect(replay.committed).toEqual(p.history);
  });
});
