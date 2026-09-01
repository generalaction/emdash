import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef } from '@emdash/core/primitives/path/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@core/primitives/desktop-runtime/api';
import { PaletteController, definePaletteProviderCatalog } from '@core/primitives/palette/api';
import { createFilePaletteProviderDef, filePaletteProviderDef } from './file-palette-provider';

const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
}));

vi.mock('@core/features/search/api/client', () => ({
  getSearchClient: vi.fn(async () => ({
    searchWorkspaceFiles: mocks.searchWorkspaceFiles,
  })),
}));

vi.mock('../../browser/command-palette/open-command-palette-file', () => ({
  openCommandPaletteFile: vi.fn(),
}));

const context = {
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'local-workspace',
};

function fileHit(path: string, relativePath: string, filename: string) {
  return {
    resource: encodeResourceUri(hostFileRef(LOCAL_HOST_REF, hostPathFromNative(path))),
    relativePath: portablePath(relativePath),
    filename,
  };
}

describe('file palette provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchWorkspaceFiles.mockResolvedValue([]);
  });

  it('has no idle rows and does not search below two characters', async () => {
    const searchWorkspaceFiles = vi.fn(async () => []);
    const provider = createFilePaletteProviderDef({
      searchWorkspaceFiles,
    });
    const controller = new PaletteController(definePaletteProviderCatalog([provider]));

    await controller.setInput('', context);
    await controller.setInput('@files i', context);

    expect(controller.getSnapshot().results).toEqual([]);
    expect(searchWorkspaceFiles).not.toHaveBeenCalled();

    await controller.setInput('@files in', context);

    expect(controller.getSnapshot().mode?.keyword).toBe('@files');
    expect(searchWorkspaceFiles).toHaveBeenCalledOnce();
    expect(searchWorkspaceFiles).toHaveBeenCalledWith({
      workspaceId: 'local-workspace',
      query: 'in',
      limit: 20,
    });
  });

  it.each(['local-workspace', 'remote-workspace'])(
    'delegates %s queries to the existing workspace file search',
    async (workspaceId) => {
      await filePaletteProviderDef.search({
        query: 'index',
        context: { ...context, workspaceId },
      });

      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith({
        workspaceId,
        query: 'index',
        limit: 20,
      });
    }
  );

  it('maps filename matches as primary and displays the workspace-relative path', async () => {
    const hit = fileHit(
      '/repo/src/components/button.tsx',
      'src/components/button.tsx',
      'button.tsx'
    );
    const provider = createFilePaletteProviderDef({
      searchWorkspaceFiles: vi.fn(async () => [hit]),
    });

    await expect(provider.search({ query: 'button.tsx', context })).resolves.toEqual([
      {
        id: hit.resource,
        title: 'button.tsx',
        subtitle: 'src/components/button.tsx',
        resource: hit.resource,
        relativePath: hit.relativePath,
        projectId: 'project-1',
        taskId: 'task-1',
        relevance: { band: 'exact', score: 1 },
      },
    ]);
  });

  it('maps path-only matches as secondary and omits unrelated candidates', async () => {
    const button = fileHit(
      '/repo/src/components/button.tsx',
      'src/components/button.tsx',
      'button.tsx'
    );
    const provider = createFilePaletteProviderDef({
      searchWorkspaceFiles: vi.fn(async () => [
        button,
        fileHit('/repo/test/dialog.test.tsx', 'test/dialog.test.tsx', 'dialog.test.tsx'),
      ]),
    });

    const matches = await provider.search({ query: 'components', context });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: button.resource,
      subtitle: 'src/components/button.tsx',
      relevance: { band: 'secondary' },
    });
  });
});
