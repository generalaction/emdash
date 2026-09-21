import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { TaskLifecycleHooks } from '@core/features/tasks/api/node/task-service';
import type { Conversation } from '@core/primitives/conversations/api';
import { HookCore } from '@core/primitives/hooks/api/hookable';
import type { Project } from '@core/primitives/projects/api';
import type { Task } from '@core/primitives/tasks/api';
import { createSearchService, type SearchService } from './search-service';

describe('SearchService entity index updates', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let service: SearchService;
  let taskEvents: HookCore<TaskLifecycleHooks>;
  let unsubscribe: (() => void)[] = [];

  const context = { projectId: 'project-1', taskId: 'task-1' };
  const conversation: Conversation = {
    id: 'conversation-1',
    ...context,
    providerId: 'claude',
    title: 'Triage Alpha',
    lastInteractedAt: null,
    isInitialConversation: false,
  };
  const task: Task = {
    id: context.taskId,
    projectId: context.projectId,
    name: 'Triage Alpha',
    status: 'in_progress',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    statusChangedAt: '2026-01-01',
    isPinned: false,
    prs: [],
    conversations: {},
    type: 'task',
  };

  beforeEach(async () => {
    fixture = await openFixture('empty');
    unsubscribe = [];
    const onConversation = conversationEvents.on.bind(conversationEvents);
    vi.spyOn(conversationEvents, 'on').mockImplementation((name, handler) => {
      const off = onConversation(name, handler);
      unsubscribe.push(off);
      return off;
    });
    const onProject = projectEvents.on.bind(projectEvents);
    vi.spyOn(projectEvents, 'on').mockImplementation((name, handler) => {
      const off = onProject(name, handler);
      unsubscribe.push(off);
      return off;
    });
    taskEvents = new HookCore<TaskLifecycleHooks>((name, error) => {
      throw new Error(`${name}: ${String(error)}`);
    });
    service = createSearchService({
      db: fixture.db,
      sqlite: fixture.sqlite,
      tasks: taskEvents,
      acquireWorkspaceRuntime: async () => null,
      searchFileSearchRoot: async () => [],
      getSearchExclusions: async () => [],
    });
    service.initialize();
  });

  afterEach(() => {
    for (const off of unsubscribe) off();
    vi.restoreAllMocks();
    fixture?.close();
  });

  function search(kind: 'task' | 'project' | 'conversation', query: string) {
    return service.searchEntities({ kind, query, context });
  }

  function indexRows(kind: string, id: string) {
    return fixture.sqlite
      .prepare(
        `SELECT project_id, task_id, title, keywords FROM search_index
         WHERE item_type = ? AND item_id = ?`
      )
      .all(kind, id);
  }

  it('replaces conversation titles after repeated renames and removes the entity on deletion', async () => {
    conversationEvents._emit('conversation:created', conversation);
    await expect(search('conversation', 'Triage')).resolves.toHaveLength(1);

    // Existing duplicate rows must also be removed by the next update.
    fixture.sqlite.exec('INSERT INTO search_index SELECT * FROM search_index');

    for (const title of ['Triage Beta', 'Triage Gamma']) {
      conversationEvents._emit(
        'conversation:renamed',
        conversation.id,
        context.projectId,
        context.taskId,
        title
      );
      expect(indexRows('conversation', conversation.id)).toEqual([
        { project_id: context.projectId, task_id: context.taskId, title, keywords: '' },
      ]);
      await expect(search('conversation', 'Triage')).resolves.toEqual([
        expect.objectContaining({ id: conversation.id, title }),
      ]);
    }
    await expect(search('conversation', 'Alpha')).resolves.toEqual([]);
    await expect(search('conversation', 'Beta')).resolves.toEqual([]);

    conversationEvents._emit('conversation:deleted', conversation.id);
    expect(indexRows('conversation', conversation.id)).toEqual([]);
    await expect(search('conversation', 'Triage')).resolves.toEqual([]);
  });

  it.each(['task:deleted', 'task:archived'] as const)(
    'replaces task titles and keywords, then removes the entity on %s',
    async (removeEvent) => {
      taskEvents.callHookSync('task:created', task, {
        id: task.id,
        projectId: task.projectId,
        taskConfig: { version: '1', name: task.name },
        workspaceConfig: {
          version: '2',
          git: { kind: 'use-branch', branchName: 'main' },
          workspace: { kind: 'new-worktree' },
        },
      });
      await expect(search('task', 'Triage')).resolves.toHaveLength(1);

      for (const suffix of ['Beta', 'Gamma']) {
        taskEvents.callHookSync('task:updated', {
          ...task,
          name: `Triage ${suffix}`,
          linkedIssue: {
            provider: 'linear',
            identifier: `ISSUE-${suffix}`,
            title: `Issue ${suffix}`,
            url: `https://linear.app/example/issue/ISSUE-${suffix}`,
          },
        });
        expect(indexRows('task', task.id)).toEqual([
          {
            project_id: task.projectId,
            task_id: null,
            title: `Triage ${suffix}`,
            keywords: `ISSUE-${suffix} Issue ${suffix}`,
          },
        ]);
        await expect(search('task', 'Triage')).resolves.toEqual([
          expect.objectContaining({ id: task.id, title: `Triage ${suffix}` }),
        ]);
      }
      await expect(search('task', 'Alpha')).resolves.toEqual([]);
      await expect(search('task', 'Beta')).resolves.toEqual([]);
      await expect(search('task', 'ISSUE-Gamma')).resolves.toHaveLength(1);

      taskEvents.callHookSync(removeEvent, task.id, task.projectId);
      expect(indexRows('task', task.id)).toEqual([]);
      await expect(search('task', 'Triage')).resolves.toEqual([]);
    }
  );

  it('replaces repeated project inserts without removing another entity with the same ID', async () => {
    const project: Project = {
      type: 'local',
      id: conversation.id,
      name: 'Triage Alpha',
      path: '/repo/alpha',
      baseRef: null,
      repositoryWorkspaceId: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    conversationEvents._emit('conversation:created', conversation);
    for (const suffix of ['Alpha', 'Beta']) {
      projectEvents._emit('project:created', {
        ...project,
        name: `Triage ${suffix}`,
        path: `/repo/${suffix.toLowerCase()}`,
      });
    }
    projectEvents._emit('project:renamed', project.id, 'Triage Gamma');
    expect(indexRows('project', project.id)).toEqual([
      { project_id: null, task_id: null, title: 'Triage Gamma', keywords: '/repo/beta' },
    ]);
    await expect(search('project', 'Triage')).resolves.toEqual([
      expect.objectContaining({ id: project.id, title: 'Triage Gamma' }),
    ]);
    await expect(search('project', 'Alpha')).resolves.toEqual([]);

    projectEvents._emit('project:deleted', project.id);
    await expect(search('project', 'Triage')).resolves.toEqual([]);
    await expect(search('conversation', 'Alpha')).resolves.toHaveLength(1);
  });

  it('keeps the previous searchable row if its replacement fails', async () => {
    conversationEvents._emit('conversation:created', conversation);
    const prepare = fixture.sqlite.prepare.bind(fixture.sqlite);
    const failure = vi.spyOn(fixture.sqlite, 'prepare').mockImplementation((sql) => {
      if (/INSERT.*INTO search_index/i.test(sql)) throw new Error('Simulated insert failure');
      return prepare(sql);
    });

    conversationEvents._emit(
      'conversation:renamed',
      conversation.id,
      context.projectId,
      context.taskId,
      'Triage Beta'
    );
    failure.mockRestore();

    await expect(search('conversation', 'Triage')).resolves.toEqual([
      expect.objectContaining({ id: conversation.id, title: 'Triage Alpha' }),
    ]);
  });
});
