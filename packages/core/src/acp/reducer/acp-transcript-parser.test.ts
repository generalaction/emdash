/**
 * Unit tests for AcpTranscriptParser.
 *
 * Uses hand-authored minimal SessionUpdate objects — no captured fixtures.
 * Fixture-driven provider-specific tests are a separate follow-up.
 */

import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpTranscriptParser } from './parser';
import { makeMessageId, makeThinkingId, makeToolId, makeTurnId, makeDiffId } from './ids';

const CID = 'conv-1';

function deps() {
  return { conversationId: CID };
}

function userChunk(messageId: string, text: string): SessionUpdate {
  return {
    sessionUpdate: 'user_message_chunk',
    sessionId: 'sess-1',
    messageId,
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

function assistantChunk(messageId: string, text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    sessionId: 'sess-1',
    messageId,
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

function thoughtChunk(messageId: string, text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_thought_chunk',
    sessionId: 'sess-1',
    messageId,
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

function toolCallUpdate(toolCallId: string, title: string, toolKind = 'other'): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    sessionId: 'sess-1',
    toolCallId,
    title,
    kind: toolKind,
    status: 'in_progress',
    content: [],
  } as unknown as SessionUpdate;
}

function toolUpdateDone(toolCallId: string): SessionUpdate {
  return {
    sessionUpdate: 'tool_call_update',
    sessionId: 'sess-1',
    toolCallId,
    title: null,
    kind: null,
    status: 'completed',
    content: [],
  } as unknown as SessionUpdate;
}

function toolUpdateWithDiff(
  toolCallId: string,
  path: string,
  oldText: string | null,
  newText: string,
  status = 'completed'
): SessionUpdate {
  return {
    sessionUpdate: 'tool_call_update',
    sessionId: 'sess-1',
    toolCallId,
    title: null,
    kind: 'edit',
    status,
    content: [{ type: 'diff', path, oldText, newText }],
  } as unknown as SessionUpdate;
}

function planUpdate(entries: Array<{ content: string; status: string; priority: string }>): SessionUpdate {
  return {
    sessionUpdate: 'plan',
    sessionId: 'sess-1',
    entries,
  } as unknown as SessionUpdate;
}

describe('AcpTranscriptParser', () => {

  it('single user+assistant exchange produces one committed turn after endTurn', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'hello'));
    p.push(assistantChunk('a1', 'hi'));
    p.endTurn();

    expect(p.history).toHaveLength(1);
    expect(p.activeTurn).toBeNull();

    const turn = p.history[0];
    expect(turn.id).toBe(makeTurnId(CID, 0));
    expect(turn.items).toHaveLength(2);
    expect(turn.items[0].kind).toBe('message');
    expect(turn.items[1].kind).toBe('message');
  });

  it('N user messages produce N committed turns after live push+endTurn sequence', () => {
    const p = new AcpTranscriptParser(deps());

    p.push(userChunk('u1', 'first'));
    p.push(assistantChunk('a1', 'one'));
    p.endTurn();

    p.push(userChunk('u2', 'second'));
    p.push(assistantChunk('a2', 'two'));
    p.endTurn();

    p.push(userChunk('u3', 'third'));
    p.push(assistantChunk('a3', 'three'));
    p.endTurn();

    expect(p.history).toHaveLength(3);
    expect(p.history[0].id).toBe(makeTurnId(CID, 0));
    expect(p.history[1].id).toBe(makeTurnId(CID, 1));
    expect(p.history[2].id).toBe(makeTurnId(CID, 2));
  });

  it('new user message automatically closes the previous turn (implicit boundary)', () => {
    const p = new AcpTranscriptParser(deps());

    p.push(userChunk('u1', 'first'));
    p.push(assistantChunk('a1', 'response'));
    // No explicit endTurn — the next user message should close this turn.
    p.push(userChunk('u2', 'second'));

    expect(p.history).toHaveLength(1);
    expect(p.activeTurn).not.toBeNull();
    expect(p.activeTurn?.id).toBe(makeTurnId(CID, 1));
  });

  // ── Multi-chunk same messageId stays one turn ─────────────────────────────

  it('multiple chunks with the same messageId accumulate into one message item', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'hel'));
    p.push(userChunk('u1', 'lo'));   // same messageId → same message row
    p.endTurn();

    const turn = p.history[0];
    const messages = turn.items.filter((i) => i.kind === 'message');
    expect(messages).toHaveLength(1);
    expect((messages[0] as { text: string }).text).toBe('hello');
  });

  it('chunks with different messageIds open different rows within the same turn', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'question'));
    p.push(assistantChunk('a1', 'part1 '));
    p.push(assistantChunk('a1', 'part2'));  // same assistant id → append
    p.endTurn();

    const turn = p.history[0];
    const messages = turn.items.filter((i) => i.kind === 'message');
    expect(messages).toHaveLength(2); // one user, one assistant
    const asst = messages.find((m) => (m as { role: string }).role === 'assistant') as { text: string };
    expect(asst.text).toBe('part1 part2');
  });

  // ── Message id stability ──────────────────────────────────────────────────

  it('item ids are non-null and stable across chunks', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'chunk1'));
    const turnId = makeTurnId(CID, 0);
    const expectedId = makeMessageId(turnId, 'u1', 'user');

    const liveItems = p.activeTurn?.items ?? [];
    expect(liveItems[0].id).toBe(expectedId);

    p.push(userChunk('u1', 'chunk2'));  // same id, text appended
    expect(p.activeTurn?.items[0].id).toBe(expectedId);
  });

  it('falls back to role as message id when messageId is absent', () => {
    const p = new AcpTranscriptParser(deps());
    // Simulate a provider that doesn't supply messageId (null)
    const update: SessionUpdate = {
      sessionUpdate: 'user_message_chunk',
      sessionId: 'sess-1',
      messageId: undefined,
      content: { type: 'text', text: 'hi' },
    } as unknown as SessionUpdate;
    p.push(update);

    const turnId = makeTurnId(CID, 0);
    const expectedId = makeMessageId(turnId, 'user', 'user'); // falls back to 'user'
    expect(p.activeTurn?.items[0].id).toBe(expectedId);
  });

  // ── Lazy agent-initiated turn ─────────────────────────────────────────────

  it('agent content with no preceding user message opens a lazy turn', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(assistantChunk('a1', 'unsolicited'));
    p.endTurn();

    expect(p.history).toHaveLength(1);
    const turn = p.history[0];
    expect(turn.items[0].kind).toBe('message');
    expect((turn.items[0] as { role: string }).role).toBe('assistant');
  });

  // ── Thinking auto-finalize ────────────────────────────────────────────────

  it('open thinking row is finalized when a message chunk arrives', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'question'));
    p.push(thoughtChunk('t1', 'thinking...'));
    // Thinking is still open — next content event should finalize it.
    p.push(assistantChunk('a1', 'answer'));

    const items = p.activeTurn?.items ?? [];
    const thinking = items.find((i) => i.kind === 'thinking') as { status: string } | undefined;
    expect(thinking?.status).toBe('done');
  });

  it('thinking row has correct id', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'q'));
    p.push(thoughtChunk('t1', 'musing'));

    const turnId = makeTurnId(CID, 0);
    const expectedId = makeThinkingId(turnId, 't1');
    const items = p.activeTurn?.items ?? [];
    expect(items.find((i) => i.kind === 'thinking')?.id).toBe(expectedId);
  });

  // ── Tool call ─────────────────────────────────────────────────────────────

  it('tool_call creates a tool row with running status', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'do something'));
    p.push(toolCallUpdate('tc1', 'My Tool'));

    const items = p.activeTurn?.items ?? [];
    const tool = items.find((i) => i.kind === 'tool');
    expect(tool).toBeDefined();
    expect((tool as { status: string }).status).toBe('running');
    expect((tool as { id: string }).id).toBe(makeToolId(makeTurnId(CID, 0), 'tc1'));
  });

  it('tool_call_update updates tool status to done', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'do it'));
    p.push(toolCallUpdate('tc1', 'My Tool'));
    p.push(toolUpdateDone('tc1'));

    const items = p.activeTurn?.items ?? [];
    const tool = items.find((i) => i.kind === 'tool');
    expect((tool as { status: string }).status).toBe('done');
  });

  it('tool kinds can materialize richer tool rows', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'use tools'));
    p.push(toolCallUpdate('search-1', 'Find symbols', 'search'));
    p.push(toolCallUpdate('mcp-1', 'linear.searchIssues', 'mcp-tool'));
    p.push(toolCallUpdate('fetch-1', 'https://example.test', 'web-fetch'));
    p.push(toolCallUpdate('subagent-1', 'Investigate failure', 'subagent'));

    const items = p.activeTurn?.items ?? [];
    expect(items.find((i) => i.kind === 'search')).toMatchObject({
      id: makeToolId(makeTurnId(CID, 0), 'search-1'),
      query: 'Find symbols',
      status: 'running',
    });
    expect(items.find((i) => i.kind === 'mcp-tool')).toMatchObject({
      tool: 'linear.searchIssues',
    });
    expect(items.find((i) => i.kind === 'web-fetch')).toMatchObject({
      url: 'https://example.test',
    });
    expect(items.find((i) => i.kind === 'subagent')).toMatchObject({
      name: 'Investigate failure',
    });
  });

  it('pushEvent can materialize enriched special tool events', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'search'));
    p.pushEvent({
      kind: 'search',
      toolCallId: 'search-1',
      query: 'NormalizedEvent',
      status: 'completed',
      parentToolCallId: null,
      matchCount: 3,
    });

    expect(p.activeTurn?.items.find((i) => i.kind === 'search')).toMatchObject({
      query: 'NormalizedEvent',
      status: 'done',
      matchCount: 3,
    });
  });

  // ── Diff arriving on a later tool_update ─────────────────────────────────

  it('diff arriving on tool_update creates diff row (late diff)', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'edit file'));
    // tool_call with kind=edit but no diffs yet → no placeholder row
    p.push({
      sessionUpdate: 'tool_call',
      sessionId: 'sess-1',
      toolCallId: 'tc-edit',
      title: 'Edit file',
      kind: 'edit',
      status: 'in_progress',
      content: [],
    } as unknown as SessionUpdate);
    // diff arrives on tool_update
    p.push(toolUpdateWithDiff('tc-edit', 'src/foo.ts', 'old', 'new'));

    const items = p.activeTurn?.items ?? [];
    const diff = items.find((i) => i.kind === 'diff');
    expect(diff).toBeDefined();
    const turnId = makeTurnId(CID, 0);
    const toolId = makeToolId(turnId, 'tc-edit');
    expect(diff?.id).toBe(makeDiffId(toolId, 'src/foo.ts'));
    expect((diff as { status: string }).status).toBe('done');
    // No generic tool placeholder row for edit kind
    expect(items.filter((i) => i.kind === 'tool')).toHaveLength(0);
  });

  // ── Plan ──────────────────────────────────────────────────────────────────

  it('plan update creates a plan row', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'make a plan'));
    p.push(planUpdate([{ content: 'Step 1', status: 'pending', priority: 'high' }]));

    const items = p.activeTurn?.items ?? [];
    const plan = items.find((i) => i.kind === 'plan');
    expect(plan).toBeDefined();
    expect((plan as { streaming: boolean }).streaming).toBe(true);
  });

  // ── replay vs push+endTurn parity ─────────────────────────────────────────

  it('replay produces the same committed turns as push+endTurn for two exchanges', () => {
    const updates: SessionUpdate[] = [
      userChunk('u1', 'first prompt'),
      assistantChunk('a1', 'first response'),
      userChunk('u2', 'second prompt'),
      assistantChunk('a2', 'second response'),
    ];

    // Live path
    const live = new AcpTranscriptParser(deps());
    live.push(updates[0]);
    live.push(updates[1]);
    live.endTurn();
    live.push(updates[2]);
    live.push(updates[3]);
    live.endTurn();
    const liveHistory = live.history;

    // Replay path
    const replayResult = AcpTranscriptParser.replay(updates, deps());
    const replayHistory = replayResult.transcript.committed;

    expect(replayResult.transcript.active).toBeNull();
    expect(replayHistory).toHaveLength(2);
    expect(liveHistory).toHaveLength(2);

    // Same turn count and item counts per turn
    for (let i = 0; i < 2; i++) {
      expect(replayHistory[i].items).toHaveLength(liveHistory[i].items.length);
    }

    // Key invariant: message text is identical
    const liveText = liveHistory.flatMap((t: { items: { kind: string; text?: string }[] }) =>
      t.items.filter((i) => i.kind === 'message').map((i) => (i as { text: string }).text)
    );
    const replayText = replayHistory.flatMap((t: { items: { kind: string; text?: string }[] }) =>
      t.items.filter((i) => i.kind === 'message').map((i) => (i as { text: string }).text)
    );
    expect(replayText).toEqual(liveText);
  });

  it('replay and live produce the same transcript shape', () => {
    const updates = [userChunk('u1', 'hi'), assistantChunk('a1', 'hello')];

    const p = new AcpTranscriptParser(deps());
    p.push(updates[0]);
    p.push(updates[1]);
    p.endTurn();

    const replayResult = AcpTranscriptParser.replay(updates, deps());
    expect(replayResult.transcript.committed[0]).toEqual(p.history[0]);
  });

  // ── Finalization on commit ────────────────────────────────────────────────

  it('committed turn has streaming=false on all messages', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'hello'));
    p.push(assistantChunk('a1', 'world'));
    p.endTurn();

    const turn = p.history[0];
    for (const item of turn.items) {
      if (item.kind === 'message') {
        expect(item.streaming).toBe(false);
      }
    }
  });

  it('active turn messages are streaming=true before commit', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'hello'));
    p.push(assistantChunk('a1', 'world'));

    const activeMsgs = (p.activeTurn?.items ?? []).filter((i) => i.kind === 'message');
    for (const m of activeMsgs) {
      expect((m as { streaming: boolean }).streaming).toBe(true);
    }
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it('reset clears all state', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(userChunk('u1', 'hello'));
    p.endTurn();
    expect(p.history).toHaveLength(1);

    p.reset();
    expect(p.history).toHaveLength(0);
    expect(p.activeTurn).toBeNull();
  });
});

// ── Session slice tests ──────────────────────────────────────────────────────

function configOptionUpdate(configOptions: unknown[]): SessionUpdate {
  return {
    sessionUpdate: 'config_option_update',
    sessionId: 'sess-1',
    configOptions,
  } as unknown as SessionUpdate;
}

function currentModeUpdate(currentModeId: string): SessionUpdate {
  return {
    sessionUpdate: 'current_mode_update',
    sessionId: 'sess-1',
    currentModeId,
  } as unknown as SessionUpdate;
}

function availableCommandsUpdate(availableCommands: unknown[]): SessionUpdate {
  return {
    sessionUpdate: 'available_commands_update',
    sessionId: 'sess-1',
    availableCommands,
  } as unknown as SessionUpdate;
}

function usageUpdate(used: number, size: number, cost?: { amount: number; currency: string }): SessionUpdate {
  return {
    sessionUpdate: 'usage_update',
    sessionId: 'sess-1',
    used,
    size,
    cost: cost ?? null,
  } as unknown as SessionUpdate;
}

function sessionInfoUpdate(title: string): SessionUpdate {
  return {
    sessionUpdate: 'session_info_update',
    sessionId: 'sess-1',
    title,
  } as unknown as SessionUpdate;
}

describe('AcpTranscriptParser – session slices', () => {
  // ── Config derivation ──────────────────────────────────────────────────────

  it('config_option_update populates modelOptions, efforts, modeOptions', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(configOptionUpdate([
      {
        id: 'model', category: 'model', type: 'select', currentValue: 'opus',
        options: [{ value: 'opus', name: 'Opus' }, { value: 'haiku', name: 'Haiku' }],
      },
      {
        id: 'effort', category: 'thought_level', type: 'select', currentValue: 'high',
        options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
      },
      {
        id: 'mode', category: 'mode', type: 'select', currentValue: 'default',
        options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }],
      },
    ]));

    const { modelOptions, efforts, modeOptions } = p.config;

    expect(modelOptions?.selected).toBe('opus');
    expect(modelOptions?.available).toHaveLength(2);
    expect(modelOptions?.available[0]).toEqual({ id: 'opus', name: 'Opus' });

    expect(efforts?.selected).toBe('high');
    expect(efforts?.available).toHaveLength(2);
    expect(efforts?.available[1]).toEqual({ id: 'high', name: 'High' });

    expect(modeOptions?.selected).toBe('default');
    expect(modeOptions?.available).toHaveLength(2);
    expect(modeOptions?.available[0]).toEqual({ id: 'default', name: 'Default' });
  });

  it('config_option_update preserves description on options', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(configOptionUpdate([
      {
        id: 'model', category: 'model', type: 'select', currentValue: 'opus',
        options: [{ value: 'opus', name: 'Opus', description: 'Most capable' }],
      },
    ]));
    expect(p.config.modelOptions?.available[0].description).toBe('Most capable');
  });

  it('unknown category (model_config) is ignored', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(configOptionUpdate([
      {
        id: 'fast', category: 'model_config', type: 'select', currentValue: 'off',
        options: [{ value: 'on', name: 'On' }, { value: 'off', name: 'Off' }],
      },
    ]));
    // No crash; all groups remain null since no recognized category was present
    expect(p.config.modelOptions).toBeNull();
    expect(p.config.efforts).toBeNull();
    expect(p.config.modeOptions).toBeNull();
  });

  // ── current_mode_update ────────────────────────────────────────────────────

  it('current_mode_update sets modeOptions.selected when modeOptions is already populated', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(configOptionUpdate([
      {
        id: 'mode', category: 'mode', type: 'select', currentValue: 'default',
        options: [{ value: 'default', name: 'Default' }, { value: 'acceptEdits', name: 'Accept Edits' }],
      },
    ]));
    expect(p.config.modeOptions?.selected).toBe('default');

    p.push(currentModeUpdate('acceptEdits'));
    expect(p.config.modeOptions?.selected).toBe('acceptEdits');
    // available list unchanged
    expect(p.config.modeOptions?.available).toHaveLength(2);
  });

  it('current_mode_update is a no-op when modeOptions is null', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(currentModeUpdate('acceptEdits'));
    expect(p.config.modeOptions).toBeNull();
  });

  // ── available_commands_update ──────────────────────────────────────────────

  it('available_commands_update populates availableCommands', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(availableCommandsUpdate([
      { name: 'review', description: 'Review code' },
      { name: 'debug', description: 'Enable debug', input: { hint: '[issue]' } },
    ]));
    expect(p.config.availableCommands).toHaveLength(2);
    expect(p.config.availableCommands[0]).toEqual({ name: 'review', description: 'Review code' });
    expect(p.config.availableCommands[1]).toEqual({ name: 'debug', description: 'Enable debug', inputHint: '[issue]' });
  });

  it('available_commands_update replaces previous list', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(availableCommandsUpdate([{ name: 'a', description: 'A' }]));
    p.push(availableCommandsUpdate([{ name: 'b', description: 'B' }, { name: 'c', description: 'C' }]));
    expect(p.config.availableCommands).toHaveLength(2);
    expect(p.config.availableCommands[0].name).toBe('b');
  });

  // ── usage_update ───────────────────────────────────────────────────────────

  it('usage_update sets usage fields correctly', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(usageUpdate(1000, 200000, { amount: 0.02, currency: 'USD' }));
    expect(p.usage).toEqual({ contextUsed: 1000, contextSize: 200000, cost: { amount: 0.02, currency: 'USD' } });
  });

  it('usage_update with no cost sets cost to null', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(usageUpdate(500, 100000));
    expect(p.usage?.cost).toBeNull();
  });

  it('usage_update overwrites previous usage', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(usageUpdate(1000, 200000));
    p.push(usageUpdate(2000, 200000));
    expect(p.usage?.contextUsed).toBe(2000);
  });

  // ── session_info_update ────────────────────────────────────────────────────

  it('session_info_update sets title', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(sessionInfoUpdate('My session title'));
    expect(p.title).toBe('My session title');
  });

  it('session_info_update overwrites previous title', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(sessionInfoUpdate('First'));
    p.push(sessionInfoUpdate('Second'));
    expect(p.title).toBe('Second');
  });

  // ── No turn boundary side-effect ───────────────────────────────────────────

  it('config/usage/title events do NOT open a transcript turn', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(configOptionUpdate([
      { id: 'model', category: 'model', type: 'select', currentValue: 'opus', options: [] },
    ]));
    p.push(usageUpdate(100, 200000));
    p.push(sessionInfoUpdate('A title'));
    p.push(availableCommandsUpdate([{ name: 'foo', description: 'Foo' }]));

    // None of the above should open a turn
    expect(p.activeTurn).toBeNull();
    expect(p.history).toHaveLength(0);
  });

  // ── reset clears session slices ────────────────────────────────────────────

  it('reset clears config, usage, and title', () => {
    const p = new AcpTranscriptParser(deps());
    p.push(usageUpdate(1000, 200000));
    p.push(sessionInfoUpdate('Some title'));
    p.push(configOptionUpdate([
      { id: 'model', category: 'model', type: 'select', currentValue: 'opus', options: [] },
    ]));
    p.reset();
    expect(p.usage).toBeNull();
    expect(p.title).toBeNull();
    expect(p.config.modelOptions).toBeNull();
    expect(p.config.availableCommands).toHaveLength(0);
  });

  // ── static replay includes session slices ──────────────────────────────────

  it('static replay returns config, usage, title alongside transcript', () => {
    const updates = [
      configOptionUpdate([
        { id: 'model', category: 'model', type: 'select', currentValue: 'haiku', options: [{ value: 'haiku', name: 'Haiku' }] },
      ]),
      usageUpdate(500, 100000, { amount: 0.001, currency: 'USD' }),
      sessionInfoUpdate('Replay title'),
    ] as unknown as SessionUpdate[];

    const result = AcpTranscriptParser.replay(updates as Iterable<SessionUpdate>, deps());
    expect(result.transcript.active).toBeNull();
    expect(result.config.modelOptions?.selected).toBe('haiku');
    expect(result.usage?.contextUsed).toBe(500);
    expect(result.title).toBe('Replay title');
  });
});
