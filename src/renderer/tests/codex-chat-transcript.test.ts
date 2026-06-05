import { describe, expect, it } from 'vitest';
import {
  applyCodexChatEvent,
  emptyTranscript,
  formatTurnDuration,
  groupChatItems,
  summarizeActivity,
  transcriptFromState,
  turnKeyOf,
  upsertChatItem,
  type ActivityChatItem,
} from '@renderer/features/tasks/conversations/codex-chat/codex-chat-transcript';
import type { CodexChatItem } from '@shared/native-chat';

const userItem: CodexChatItem = { kind: 'user_message', key: 't1:user', text: 'hi' };
const agentItem: CodexChatItem = { kind: 'agent_message', key: 't1:item_0', text: 'hello' };

describe('codex chat transcript', () => {
  it('starts a turn by clearing the previous error', () => {
    const failed = applyCodexChatEvent(emptyTranscript(), {
      type: 'turn-failed',
      message: 'boom',
    });
    expect(failed).toMatchObject({ turnStatus: 'idle', lastError: 'boom' });

    const restarted = applyCodexChatEvent(failed, { type: 'turn-started' });
    expect(restarted).toMatchObject({ turnStatus: 'running', lastError: null });
  });

  it('appends new items and replaces items with the same key', () => {
    let transcript = applyCodexChatEvent(emptyTranscript(), {
      type: 'item-upsert',
      item: userItem,
    });
    transcript = applyCodexChatEvent(transcript, { type: 'item-upsert', item: agentItem });
    expect(transcript.items).toEqual([userItem, agentItem]);

    const updatedAgent: CodexChatItem = { ...agentItem, text: 'hello world' };
    transcript = applyCodexChatEvent(transcript, { type: 'item-upsert', item: updatedAgent });
    expect(transcript.items).toEqual([userItem, updatedAgent]);
  });

  it('completes a turn back to idle', () => {
    const running = applyCodexChatEvent(emptyTranscript(), { type: 'turn-started' });
    expect(applyCodexChatEvent(running, { type: 'turn-completed' }).turnStatus).toBe('idle');
  });

  it('records turn durations on completion and failure', () => {
    let transcript = applyCodexChatEvent(emptyTranscript(), { type: 'turn-started' });
    transcript = applyCodexChatEvent(transcript, {
      type: 'turn-completed',
      turnKey: 't1',
      durationMs: 3200,
    });
    transcript = applyCodexChatEvent(transcript, {
      type: 'turn-failed',
      message: 'boom',
      turnKey: 't2',
      durationMs: 900,
    });
    expect(transcript.turnDurationsMs).toEqual({ t1: 3200, t2: 900 });
  });

  it('replays buffered events idempotently over a seeded state', () => {
    const seeded = transcriptFromState({
      conversationId: 'c1',
      items: [userItem, agentItem],
      turnStatus: 'running',
      lastError: null,
      turnDurationsMs: {},
    });
    // The same item arriving again as an event must not duplicate.
    const replayed = applyCodexChatEvent(seeded, { type: 'item-upsert', item: agentItem });
    expect(replayed.items).toHaveLength(2);
  });

  it('upsertChatItem does not mutate its input', () => {
    const items = [userItem];
    const next = upsertChatItem(items, agentItem);
    expect(items).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

const command = (key: string): CodexChatItem => ({
  kind: 'command_execution',
  key,
  command: 'ls',
  aggregatedOutput: '',
  exitCode: 0,
  status: 'completed',
});

describe('groupChatItems', () => {
  it('folds consecutive work items into one activity segment', () => {
    const reasoning: CodexChatItem = { kind: 'reasoning', key: 't1:item_0', text: 'thinking' };
    const segments = groupChatItems([
      userItem,
      reasoning,
      command('t1:item_1'),
      command('t1:item_2'),
      agentItem,
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: 'item', item: userItem });
    expect(segments[1]).toMatchObject({ type: 'activity' });
    expect(segments[1].type === 'activity' && segments[1].items).toHaveLength(3);
    expect(segments[2]).toEqual({ type: 'item', item: agentItem });
  });

  it('splits activity groups around messages and system notes', () => {
    const note: CodexChatItem = { kind: 'system', key: 't1:interrupted', text: 'Interrupted' };
    const segments = groupChatItems([command('t1:item_0'), note, command('t2:item_0')]);
    expect(segments.map((s) => s.type)).toEqual(['activity', 'item', 'activity']);
  });
});

describe('turn helpers', () => {
  it('extracts the turn key from item keys', () => {
    expect(turnKeyOf('t3:item_0')).toBe('t3');
    expect(turnKeyOf('t12:user')).toBe('t12');
  });

  it('formats durations compactly', () => {
    expect(formatTurnDuration(400)).toBe('1s');
    expect(formatTurnDuration(3200)).toBe('3s');
    expect(formatTurnDuration(61_000)).toBe('1m 1s');
    expect(formatTurnDuration(120_000)).toBe('2m');
  });
});

describe('summarizeActivity', () => {
  it('counts commands, file changes, searches, and tool calls', () => {
    const items: ActivityChatItem[] = [
      command('a') as ActivityChatItem,
      command('b') as ActivityChatItem,
      {
        kind: 'file_change',
        key: 'c',
        status: 'completed',
        changes: [
          { path: 'a.ts', kind: 'update' },
          { path: 'b.ts', kind: 'add' },
        ],
      },
      { kind: 'web_search', key: 'd', query: 'docs' },
    ];
    expect(summarizeActivity(items)).toBe('2 commands · 2 files · 1 search');
  });

  it('falls back to Thought for reasoning-only groups', () => {
    expect(summarizeActivity([{ kind: 'reasoning', key: 'a', text: 'hmm' }])).toBe('Thought');
  });
});
