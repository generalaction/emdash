import type { PermissionOptionKind } from '@agentclientprotocol/sdk';
import { isOk } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import { FakeAcpAgent } from '../acp-test-support';
import { SessionCell } from './cell';

function makeCell(agent = new FakeAcpAgent()) {
  const cell = new SessionCell({
    conversationId: 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId: 'claude',
    acpSessionId: 'session-1',
    agent,
    resolveAttachment: vi.fn().mockResolvedValue({ data: '', mimeType: 'image/png' }),
    logger: noopLogger,
  });
  cell.applySessionReady();
  return { cell, agent };
}

describe('SessionCell prompts', () => {
  it('synthesizes a user message and settles the turn', async () => {
    const { cell, agent } = makeCell();
    agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    const result = await cell.prompt({ text: 'hello' });

    expect(result).toEqual({ success: true, data: { queued: false } });
    expect(agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'hello' }],
    });
    const history = cell.history();
    expect(history.active).toBeNull();
    expect(history.committed).toHaveLength(1);
    expect(history.committed[0].items[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      text: 'hello',
    });
    expect(history.committed[0].outcome).toEqual({ kind: 'done', reason: 'end_turn' });
  });

  it('stores prompt drafts by monotonic revision and clears them after submit', async () => {
    const { cell, agent } = makeCell();
    agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    expect(isOk(cell.setPromptDraft({ rev: 1, input: { text: 'old' } }))).toBe(true);
    expect(isOk(cell.setPromptDraft({ rev: 1, input: { text: 'stale' } }))).toBe(true);
    expect(cell.promptDraft).toMatchObject({ text: 'old', rev: 1 });

    expect(isOk(cell.setPromptDraft({ rev: 2, input: { text: 'new' } }))).toBe(true);
    expect(cell.promptDraft).toMatchObject({ text: 'new', rev: 2 });

    await cell.prompt({ text: 'send' });
    expect(cell.promptDraft).toBeNull();
  });

  it('queues while working and drains after the active turn settles', async () => {
    const { cell, agent } = makeCell();
    let resolveFirst!: (value: { stopReason: 'end_turn' }) => void;
    agent.prompt = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ stopReason: 'end_turn' }>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ stopReason: 'end_turn' });

    const first = cell.prompt({ text: 'first' });
    const second = await cell.prompt({ text: 'second' });

    expect(second).toEqual({ success: true, data: { queued: true } });
    expect(cell.sessionState.queuedPrompts).toHaveLength(1);
    resolveFirst({ stopReason: 'end_turn' });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(agent.prompt).toHaveBeenCalledTimes(2);
    expect(cell.sessionState.queuedPrompts).toHaveLength(0);
  });

  it('keeps prompts queued while background agents run and drains after cancel settles them', async () => {
    const { cell, agent } = makeCell();
    agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    cell.push({
      kind: 'subagent',
      toolCallId: 'tool-1',
      agentId: 'agent-1',
      title: 'Background agent',
      status: 'in_progress',
      parentToolCallId: null,
      background: true,
    });
    expect(cell.sessionState.backgroundAgentCount).toBe(1);

    const queued = await cell.prompt({ text: 'queued' });
    expect(queued).toEqual({ success: true, data: { queued: true } });
    expect(agent.prompt).not.toHaveBeenCalled();

    await cell.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(agent.cancel).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(cell.transcript.agents).toMatchObject([{ agentId: 'agent-1', status: 'failed' }]);
    expect(cell.sessionState.backgroundAgentCount).toBe(0);
    expect(cell.sessionState.queuedPrompts).toHaveLength(0);
    expect(agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'queued' }],
    });
  });
});

describe('SessionCell permissions', () => {
  it('brokers permission requests through the per-cell broker', async () => {
    const { cell } = makeCell();
    const permission = cell.requestPermission({
      sessionId: 'session-1',
      toolCall: { toolCallId: 'tool-1', title: 'Read a file', kind: 'read' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' as PermissionOptionKind }],
    });

    expect(cell.sessionState.pendingPermissions).toHaveLength(1);
    expect(cell.sessionState.pendingPermissions[0].toolCall).toMatchObject({
      kind: 'read-tool-call',
      toolCallId: 'tool-1',
    });

    const result = cell.resolvePermission(
      cell.sessionState.pendingPermissions[0].requestId,
      'allow'
    );
    expect(isOk(result)).toBe(true);
    await expect(permission).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
    expect(cell.sessionState.pendingPermissions).toHaveLength(0);
  });

  it('drains pending permissions on dispose', async () => {
    const { cell } = makeCell();
    const permission = cell.requestPermission({
      sessionId: 'session-1',
      toolCall: { toolCallId: 'tool-2', title: 'Write a file', kind: 'edit' },
      options: [
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' as PermissionOptionKind },
      ],
    });

    cell.dispose();

    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('SessionCell idle turns and queue commands', () => {
  it('settles idle agent turns after quiesce', async () => {
    vi.useFakeTimers();
    try {
      const { cell } = makeCell();

      cell.push({
        kind: 'plan',
        entries: [{ content: 'Background step', status: 'in_progress', priority: 'medium' }],
      });

      expect(cell.sessionState.agentTurnActive).toBe(true);
      expect(cell.history().active?.initiator).toBe('agent');

      vi.advanceTimersByTime(300);
      await Promise.resolve();

      expect(cell.sessionState.agentTurnActive).toBe(false);
      expect(cell.history().active).toBeNull();
      expect(cell.history().committed.at(-1)?.outcome).toEqual({
        kind: 'done',
        reason: 'quiesced',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues, edits, removes, and reorders queued prompts', () => {
    const { cell } = makeCell();

    expect(isOk(cell.queuePrompt({ text: 'a' }))).toBe(true);
    expect(isOk(cell.queuePrompt({ text: 'b' }))).toBe(true);
    const [first, second] = cell.sessionState.queuedPrompts;

    expect(isOk(cell.editQueuedPrompt(first.id, { text: 'edited' }))).toBe(true);
    expect(isOk(cell.reorderQueue([second.id, first.id]))).toBe(true);
    expect(cell.sessionState.queuedPrompts.map((prompt) => prompt.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(cell.sessionState.queuedPrompts[1].text).toBe('edited');

    expect(isOk(cell.removeQueuedPrompt(first.id))).toBe(true);
    expect(cell.sessionState.queuedPrompts.map((prompt) => prompt.id)).toEqual([second.id]);
  });
});
