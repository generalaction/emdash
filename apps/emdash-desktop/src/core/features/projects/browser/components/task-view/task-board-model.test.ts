import { describe, expect, it } from 'vitest';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { projectViewSchema } from '@core/features/projects/contributions/mementos';
import type { AgentStatus } from '@core/primitives/agents/api';
import { boardConversation, boardLastActivity, taskBoardColumn } from './task-board-model';

function conversation(status: AgentStatus, sessionId?: string, id = 'conversation-1') {
  return {
    status,
    data: {
      id,
      taskId: 'task-1',
      projectId: 'project-1',
      providerId: 'claude',
      title: 'Agent',
      lastInteractedAt: null,
      isInitialConversation: true,
      sessionId,
    },
  } satisfies Pick<ConversationStore, 'data' | 'status'>;
}

describe('taskBoardColumn', () => {
  const task = { status: 'todo' as const };

  it('keeps tasks with no started session in Backlog', () => {
    expect(taskBoardColumn(task, [])).toBe('Backlog');
    expect(taskBoardColumn(task, [conversation('idle')])).toBe('Backlog');
    expect(taskBoardColumn({ status: 'in_progress' }, [conversation('idle')])).toBe('Backlog');
  });

  it.each([
    ['working', 'Running'],
    ['awaiting-input', 'Awaiting Input'],
    ['error', 'Awaiting Input'],
    ['completed', 'Review'],
    ['idle', 'Backlog'],
  ] as const)('maps a started %s session to %s', (status, column) => {
    expect(taskBoardColumn(task, [conversation(status, 'session-1')])).toBe(column);
  });

  it('does not treat an idle or cancelled session id as proof of completion', () => {
    expect(taskBoardColumn(task, [conversation('idle', 'existing-session')])).toBe('Backlog');
    expect(
      taskBoardColumn({ status: 'cancelled' }, [conversation('idle', 'existing-session')])
    ).toBe('Backlog');
  });

  it('keeps attention ahead of work, and work ahead of completed siblings and open PRs', () => {
    const conversations = [conversation('completed'), conversation('working')];
    expect(taskBoardColumn(task, conversations, { status: 'open' })).toBe('Running');
    conversations.push(conversation('awaiting-input'));
    expect(taskBoardColumn(task, conversations)).toBe('Awaiting Input');
  });

  it('uses existing PR and task lifecycle status, with Done taking precedence', () => {
    expect(taskBoardColumn(task, [], { status: 'open' })).toBe('Review');
    expect(taskBoardColumn(task, [], { status: 'closed' })).toBe('Backlog');
    expect(taskBoardColumn({ status: 'review' }, [])).toBe('Review');
    expect(taskBoardColumn(task, [conversation('working')], { status: 'merged' })).toBe('Done');
    expect(taskBoardColumn({ status: 'done' }, [conversation('working')])).toBe('Done');
    expect(taskBoardColumn({ ...task, archivedAt: '2026-10-28' }, [conversation('error')])).toBe(
      'Done'
    );
  });

  it('does not interpret arbitrary Jira status strings as agent workflow', () => {
    const linkedTask = { ...task, linkedIssue: { provider: 'jira', status: 'Done' } };
    expect(taskBoardColumn(linkedTask, [])).toBe('Backlog');
  });
});

describe('boardConversation', () => {
  it('opens the attention conversation even when another agent is working', () => {
    const waiting = conversation('awaiting-input', 'session-2', 'waiting');
    expect(boardConversation([conversation('working'), waiting])).toBe(waiting);
    expect(boardConversation([])).toBeUndefined();
  });

  it('breaks ties by last interaction without changing the source order', () => {
    const older = conversation('idle', 'session-1', 'older');
    const newer = {
      ...conversation('idle', 'session-2', 'newer'),
      data: {
        ...conversation('idle', 'session-2', 'newer').data,
        lastInteractedAt: '2026-10-28T12:00:00Z',
      },
    };
    const source = [older, newer];
    expect(boardConversation(source)).toBe(newer);
    expect(source).toEqual([older, newer]);
  });
});

describe('boardLastActivity', () => {
  const task = {
    createdAt: '2026-10-28T08:00:00Z',
    updatedAt: '2026-10-28 09:00:00',
    statusChangedAt: '2026-10-28T08:00:00Z',
    lastInteractedAt: '2026-10-28T08:30:00Z',
  };

  it('uses the latest existing timestamp, including SQLite UTC and conversation activity', () => {
    expect(boardLastActivity(task, [])).toBe(Date.parse('2026-10-28T09:00:00Z'));
    const active = conversation('working');
    const touched = {
      ...active,
      data: { ...active.data, lastInteractedAt: '2026-10-28T06:00:00-04:00' },
    };
    expect(boardLastActivity(task, [touched])).toBe(Date.parse('2026-10-28T10:00:00Z'));
    expect(boardLastActivity({ ...task, updatedAt: 'invalid' }, [])).toBe(
      Date.parse('2026-10-28T08:30:00Z')
    );
  });
});

describe('project board preference', () => {
  it('upgrades existing project preferences without losing their selection', () => {
    expect(
      projectViewSchema.safeParse({ version: '1', activeView: 'settings', taskViewTab: 'archived' })
    ).toEqual({
      status: 'ok',
      data: { version: '2', activeView: 'settings', taskViewTab: 'archived' },
    });
  });

  it('round trips the board selection through the existing memento schema', () => {
    const preference = {
      version: '2' as const,
      activeView: 'board' as const,
      taskViewTab: 'active' as const,
    };
    expect(projectViewSchema.parseJson(projectViewSchema.serialize(preference))).toEqual(
      preference
    );
  });
});
