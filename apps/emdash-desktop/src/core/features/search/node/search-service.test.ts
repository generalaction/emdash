import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { createController } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import { contentSearchRuntimeContract } from '../api';
import { createSearchService } from './search-service';

const mocks = vi.hoisted(() => ({
  fileSearch: vi.fn(),
  prepare: vi.fn(),
  workspaceGet: vi.fn(),
  warn: vi.fn(),
}));

vi.mock(import('@emdash/shared/logger'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    log: { ...actual.log, info: vi.fn(), warn: mocks.warn },
  };
});

vi.mock('@core/features/conversations/api/node/conversation-events', () => ({
  conversationEvents: { on: vi.fn() },
}));

vi.mock('@core/features/projects/api/node/project-events', () => ({
  projectEvents: { on: vi.fn() },
}));

describe('SearchService runtime file search', () => {
  const root = hostPathFromNative('/repo');
  const searchService = createSearchService({
    db: {} as never,
    sqlite: { prepare: mocks.prepare } as never,
    acquireWorkspaceRuntime: mocks.workspaceGet,
    searchFileSearchRoot: mocks.fileSearch,
    tasks: { on: vi.fn() } as never,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceGet.mockReturnValue({
      client: { fileSearch: { searchPaths: vi.fn() } },
      files: { root },
    });
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
    expect(mocks.fileSearch).toHaveBeenCalledWith(
      expect.objectContaining({ searchPaths: expect.any(Function) }),
      root,
      'index',
      undefined
    );
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

  it('relays progressive content search through the resolved workspace runtime', async () => {
    const progressGate = deferred<void>();
    let didStartSearch = false;
    const files = [
      {
        path: portablePath('src/index.ts'),
        matches: [
          {
            lineNumber: 4,
            previewText: 'const test = true;',
            locations: [
              {
                sourceRange: { startColumn: 7, endColumn: 11 },
                previewRange: { startColumn: 7, endColumn: 11 },
              },
            ],
          },
        ],
      },
    ];
    const upstream = createTestWire(
      contentSearchRuntimeContract,
      createController(contentSearchRuntimeContract, {
        searchContent: {
          run: async (input, context) => {
            didStartSearch = true;
            expect(input).toEqual({ root, query: 'test', limit: 25 });
            await progressGate.promise;
            context.progress({ files });
            return ok({ files, complete: true });
          },
        },
      }),
      { validate: 'full' }
    );
    mocks.workspaceGet.mockResolvedValue({
      client: { fileSearch: upstream.client },
      files: { root },
    });
    const progress: unknown[] = [];

    try {
      const result = searchService.searchContent(
        { workspaceId: 'workspace-1', query: 'test', limit: 25 },
        {
          jobId: 'desktop-search-1',
          signal: new AbortController().signal,
          progress: (update) => progress.push(update),
        }
      );
      await vi.waitFor(() => expect(didStartSearch).toBe(true));
      progressGate.resolve();

      await expect(result).resolves.toEqual(ok({ files, complete: true }));
      expect(progress).toEqual([{ files }]);
    } finally {
      await upstream.dispose();
    }
  });
});
