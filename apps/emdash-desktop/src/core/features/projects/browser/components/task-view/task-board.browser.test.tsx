import type { PullRequest } from '@emdash/plugins/pull-requests/schemas';
import { observable, runInAction } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { ReturnToBoard } from '@core/features/projects/contributions/browser/return-to-board';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { TaskPrAssociationStore } from '@core/features/source-control/api/browser/stores/task-pr-association-store';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { ConversationType } from '@core/primitives/conversations/api';
import { TaskBoard } from './task-board';
import type { ReadyTask } from './task-list-model';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  open: vi.fn(),
  restore: vi.fn(),
  manager: undefined as
    | { tasks: Map<string, ReadyTask>; restoreTask: (id: string) => Promise<void> }
    | undefined,
  conversations: new Map<
    string,
    { conversations: Map<string, ConversationStore>; list: { load: () => Promise<void> } }
  >(),
  projectView: undefined as { activeView: string } | undefined,
}));

vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  getTaskManagerStore: () => mocks.manager,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectViewStore: () => mocks.projectView,
}));
vi.mock('@core/features/conversations/api/browser/conversation-selectors', () => ({
  getConversationsForTask: (id: string) => mocks.conversations.get(id),
  taskConversationStats: () => ({ claude: 1 }),
}));
vi.mock('@core/features/source-control/api/browser/stores/task-source-control-selectors', () => ({
  getTaskGitCheckoutStore: () => ({ branchName: 'emdash/board-test' }),
  getTaskPrAssociationStore: (task: ReadyTask) => task.get({ id: 'pr' }),
}));
vi.mock('@core/features/workbench/api/browser/task-composition-selectors', () => ({
  getTaskComposition: () => ({
    space: { ready: Promise.resolve() },
    paneLayout: { open: mocks.open },
  }),
}));
vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));
vi.mock('@core/features/agents/api/browser/use-agent-metadata', () => ({
  useAgentMetadata: () => ({ data: [{ id: 'claude', name: 'Claude Code' }] }),
}));
vi.mock('@core/features/agents/contributions/browser/stacked-agent-logos', () => ({
  StackedAgentLogos: () => <span>Agent icon</span>,
}));

function addTask(id: string, status: AgentStatus, type: ConversationType = 'pty') {
  const association = new TaskPrAssociationStore();
  const conversationData = {
    id: `conversation-${id}`,
    taskId: id,
    projectId: 'project-1',
    title: id,
    providerId: 'claude' as const,
    lastInteractedAt: '2026-10-28T12:00:00Z',
    isInitialConversation: true,
    agentStatus: status,
    sessionId: status === 'idle' ? undefined : `session-${id}`,
    type,
  };
  const conversation = observable({
    data: conversationData,
    status,
    seen: false,
  }) as unknown as ConversationStore;
  mocks.conversations.set(id, {
    conversations: observable.map([[conversation.data.id, conversation]]),
    list: { load: async () => {} },
  });
  const task = observable({
    state: 'provisioned',
    data: {
      id,
      projectId: 'project-1',
      name: `Task ${id}`,
      status: 'todo',
      type: 'task',
      isPinned: false,
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T11:00:00Z',
      statusChangedAt: '2026-10-28T10:00:00Z',
      linkedIssue: {
        provider: 'jira',
        identifier: `EM-${id}`,
        title: `Jira title ${id}`,
        url: `https://example.atlassian.net/browse/EM-${id}`,
      },
      conversations: { claude: 1 },
    },
    get: () => association,
  }) as unknown as ReadyTask;
  mocks.manager?.tasks.set(id, task);
  return { task, conversation, association };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('project task board', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversations.clear();
    mocks.projectView = observable({ activeView: 'board' });
    mocks.manager = { tasks: observable.map(), restoreTask: mocks.restore };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function column(name: string) {
    return host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  }

  it('moves cards and counts live, without treating acknowledgement as a workflow change', async () => {
    addTask('1', 'idle');
    const { conversation } = addTask('2', 'working');
    const { association } = addTask('3', 'completed');
    await act(async () => root.render(<TaskBoard projectId="project-1" />));
    expect(column('Backlog')?.querySelectorAll('button')).toHaveLength(1);
    expect(column('Running')?.querySelectorAll('button')).toHaveLength(1);
    expect(column('Review')?.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toContain('Jira title 2');
    expect(host.textContent).toContain('EM-2');
    expect(host.textContent).toContain('Claude Code');
    expect(host.textContent).toContain('emdash/board-test');
    expect(host.querySelectorAll('time')).toHaveLength(3);

    await act(async () =>
      runInAction(() => {
        conversation.status = 'awaiting-input';
        conversation.seen = true;
      })
    );
    expect(column('Running')?.querySelector('h2')?.textContent).toBe('Running 0');
    expect(column('Awaiting Input')?.querySelector('h2')?.textContent).toBe('Awaiting Input 1');
    expect(column('Awaiting Input')?.querySelector('button')?.textContent).toContain(
      'Awaiting Input'
    );
    await act(async () =>
      runInAction(() => {
        conversation.status = 'working';
      })
    );
    expect(column('Running')?.querySelector('h2')?.textContent).toBe('Running 1');
    expect(column('Awaiting Input')?.querySelector('button')).toBeNull();
    await act(async () =>
      runInAction(() => {
        conversation.status = 'completed';
      })
    );
    expect(column('Review')?.querySelector('h2')?.textContent).toBe('Review 2');
    expect(column('Review')?.querySelector('button')?.textContent).toContain('Review');

    await act(async () =>
      association.setAssociation([{ status: 'merged' } as PullRequest], { kind: 'unknown' })
    );
    expect(column('Done')?.querySelector('h2')?.textContent).toBe('Done 1');
  });

  it.each([
    ['pty', 'conversation'],
    ['acp', 'acp-chat'],
  ] as const)(
    'opens the existing %s session and returns to the selected board',
    async (type, tabKind) => {
      addTask('1', 'working', type);
      await act(async () => root.render(<TaskBoard projectId="project-1" />));
      await act(async () => column('Running')?.querySelector<HTMLButtonElement>('button')?.click());
      expect(mocks.open).toHaveBeenCalledWith(
        tabKind,
        { conversationId: 'conversation-1' },
        { preview: false }
      );
      expect(mocks.navigate).toHaveBeenCalledWith(
        taskViewDef({ projectId: 'project-1', taskId: '1' })
      );

      await act(async () => root.render(<ReturnToBoard projectId="project-1" />));
      await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
      expect(mocks.navigate).toHaveBeenLastCalledWith(projectViewDef({ projectId: 'project-1' }));
      expect(mocks.projectView?.activeView).toBe('board');
    }
  );

  it('explicitly restores archived tasks before opening their sessions', async () => {
    const { task } = addTask('1', 'completed');
    runInAction(() => {
      task.data.archivedAt = '2026-10-28T12:00:00Z';
    });
    await act(async () => root.render(<TaskBoard projectId="project-1" />));
    const card = column('Done')?.querySelector<HTMLButtonElement>('button');
    expect(card?.getAttribute('aria-label')).toContain('Restore and open');
    await act(async () => card?.click());
    expect(mocks.restore).toHaveBeenCalledWith('1');
    expect(mocks.navigate).toHaveBeenCalledWith(
      taskViewDef({ projectId: 'project-1', taskId: '1' })
    );
  });

  it('only renders the return control when the project has Board selected', async () => {
    await act(async () => root.render(<ReturnToBoard projectId="project-1" />));
    expect(host.querySelector('button')).not.toBeNull();
    await act(async () =>
      runInAction(() => {
        if (mocks.projectView) mocks.projectView.activeView = 'tasks';
      })
    );
    expect(host.querySelector('button')).toBeNull();
  });

  it('tracks task membership live and omits automation runs like the task list', async () => {
    await act(async () => root.render(<TaskBoard projectId="project-1" />));
    expect(column('Backlog')?.querySelector('h2')?.textContent).toBe('Backlog 0');
    await act(async () =>
      runInAction(() => {
        addTask('1', 'idle');
      })
    );
    expect(column('Backlog')?.querySelector('h2')?.textContent).toBe('Backlog 1');
    await act(async () =>
      runInAction(() => {
        const { task } = addTask('2', 'working');
        task.data.type = 'automation-run';
      })
    );
    expect(column('Running')?.querySelector('h2')?.textContent).toBe('Running 0');
    await act(async () =>
      runInAction(() => {
        mocks.manager?.tasks.delete('1');
      })
    );
    expect(column('Backlog')?.querySelector('h2')?.textContent).toBe('Backlog 0');
  });

  it('sizes cards to their content instead of the shared button height', async () => {
    addTask('1', 'completed');
    addTask('2', 'completed');
    host.style.width = '360px';
    await act(async () => root.render(<TaskBoard projectId="project-1" />));

    const cards = [...(column('Review')?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const content = card.firstElementChild;
      expect(content).not.toBeNull();
      expect(card.getBoundingClientRect().height).toBeGreaterThan(32);
      expect(card.clientHeight).toBeGreaterThanOrEqual(content?.scrollHeight ?? 0);
    }
    expect(cards[1].getBoundingClientRect().top).toBeGreaterThanOrEqual(
      cards[0].getBoundingClientRect().bottom
    );
  });
});
import '@emdash/ui/style.css';
