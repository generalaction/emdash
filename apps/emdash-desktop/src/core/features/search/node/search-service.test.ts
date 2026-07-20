import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { searchService } from './search-service';

const mocks = vi.hoisted(() => ({
  fileSearch: vi.fn(),
  prepare: vi.fn(),
  workspaceGet: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
  sqlite: { prepare: mocks.prepare },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: mocks.warn },
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: { on: vi.fn() },
}));

vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { on: vi.fn() },
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { on: vi.fn() },
}));

vi.mock('@core/services/workspace-runtime-access/node', () => ({
  acquireWorkspaceRuntime: mocks.workspaceGet,
}));

vi.mock('@main/core/file-search/runtime-client', () => ({
  searchFileSearchRoot: mocks.fileSearch,
}));

describe('SearchService runtime file search', () => {
  const root = hostPathFromNative('/repo');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceGet.mockReturnValue({ files: { root }, release: vi.fn() });
    mocks.fileSearch.mockResolvedValue([{ path: '/repo/src/index.ts', filename: 'index.ts' }]);
  });

  it('merges runtime file hits after task and conversation search results', async () => {
    mocks.prepare.mockReturnValue({
      all: () => [
        {
          item_type: 'task',
          item_id: 'task-1',
          project_id: 'project-1',
          task_id: null,
          title: 'Index task',
          rank: -1,
        },
      ],
    });

    await expect(
      searchService.search({
        query: 'index',
        context: { projectId: 'project-1', taskId: 'task-1', workspaceId: 'workspace-1' },
      })
    ).resolves.toEqual([
      {
        kind: 'task',
        id: 'task-1',
        projectId: 'project-1',
        taskId: null,
        title: 'Index task',
        subtitle: '',
        score: -1,
      },
      {
        kind: 'file',
        id: '/repo/src/index.ts',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'index.ts',
        subtitle: '/repo/src/index.ts',
        score: 0,
      },
    ]);
    expect(mocks.fileSearch).toHaveBeenCalledWith(root, 'index', undefined);
  });

  it('preserves runtime file hits when the app search index fails', async () => {
    mocks.prepare.mockImplementation(() => {
      throw new Error('FTS unavailable');
    });

    await expect(
      searchService.search({
        query: 'index',
        context: { projectId: 'project-1', taskId: 'task-1', workspaceId: 'workspace-1' },
      })
    ).resolves.toEqual([
      {
        kind: 'file',
        id: '/repo/src/index.ts',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'index.ts',
        subtitle: '/repo/src/index.ts',
        score: 0,
      },
    ]);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});
