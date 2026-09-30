import { ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import { deleteProject } from '@core/features/projects/node/operations/deleteProject';
import { createSearchService } from '@core/features/search/node/search-service';
import { conversations, projects, tasks } from '@core/services/app-db/node/schema';

describe('project deletion search cleanup', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let unsubscribe: (() => void)[] = [];

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
  });

  afterEach(() => {
    for (const off of unsubscribe) off();
    vi.restoreAllMocks();
    fixture?.close();
  });

  it('removes a deleted project and its children from search while preserving another project', async () => {
    for (const suffix of ['1', '2']) {
      const projectId = `project-${suffix}`;
      const taskId = `task-${suffix}`;
      fixture.db
        .insert(projects)
        .values({ id: projectId, name: `Triage project ${suffix}` })
        .run();
      fixture.db
        .insert(tasks)
        .values({ id: taskId, projectId, name: `Triage task ${suffix}`, status: 'in_progress' })
        .run();
      fixture.db
        .insert(conversations)
        .values({
          id: `conversation-${suffix}`,
          projectId,
          taskId,
          title: `Triage conversation ${suffix}`,
        })
        .run();
    }
    const searchService = createSearchService({
      db: fixture.db,
      sqlite: fixture.sqlite,
      tasks: { on: vi.fn() },
      acquireWorkspaceRuntime: async () => null,
      searchFileSearchRoot: async () => [],
      getSearchExclusions: async () => [],
    });
    searchService.initialize();
    const search = (
      kind: 'task' | 'project' | 'conversation',
      projectId = 'project-1',
      taskId = 'task-1'
    ) => searchService.searchEntities({ kind, query: 'Triage', context: { projectId, taskId } });
    await expect(search('task')).resolves.toHaveLength(2);
    await expect(search('project')).resolves.toHaveLength(2);
    await expect(search('conversation')).resolves.toHaveLength(1);

    const deleted = await deleteProject(
      {
        db: fixture.db,
        runtimes: { client: vi.fn() },
        automations: { removeProjectDeployments: vi.fn(async () => {}) },
        getMementosRuntimeClient: vi.fn().mockResolvedValue({
          deleteBySubject: async () => ok(undefined),
          deleteOrphans: async () => ok(undefined),
        }),
        logger: log,
        projects: { invalidate: vi.fn(async () => {}) },
        pullRequests: { deleteProjectData: vi.fn(async () => {}) },
        sessionCleanup: {
          resolve: async () => ({
            acpConversationIds: [],
            tuiConversationIds: [],
            terminalSessionIds: [],
            tmuxSessionIdentities: [],
          }),
          killAcp: vi.fn(),
          killTerminals: vi.fn(),
        },
        telemetry: { capture: vi.fn() },
      },
      'project-1'
    );

    expect(deleted).toEqual(ok(undefined));
    expect(fixture.db.select({ id: projects.id }).from(projects).all()).toEqual([
      { id: 'project-2' },
    ]);
    expect(fixture.db.select({ id: tasks.id }).from(tasks).all()).toEqual([{ id: 'task-2' }]);
    expect(fixture.db.select({ id: conversations.id }).from(conversations).all()).toEqual([
      { id: 'conversation-2' },
    ]);
    expect(
      fixture.sqlite.prepare('SELECT item_type, item_id FROM search_index ORDER BY item_type').all()
    ).toEqual([
      { item_type: 'conversation', item_id: 'conversation-2' },
      { item_type: 'project', item_id: 'project-2' },
      { item_type: 'task', item_id: 'task-2' },
    ]);
    await expect(search('task')).resolves.toEqual([expect.objectContaining({ id: 'task-2' })]);
    await expect(search('project')).resolves.toEqual([
      expect.objectContaining({ id: 'project-2' }),
    ]);
    await expect(search('conversation')).resolves.toEqual([]);
    await expect(search('conversation', 'project-2', 'task-2')).resolves.toEqual([
      expect.objectContaining({ id: 'conversation-2' }),
    ]);
  });
});
