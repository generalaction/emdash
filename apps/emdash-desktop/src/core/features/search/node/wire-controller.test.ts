import { hostRef } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef } from '@emdash/core/primitives/path/api';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@core/primitives/desktop-runtime/api';
import { searchContract } from '../api';
import type { SearchService } from './search-service';
import { createSearchWireController } from './wire-controller';

describe('search Wire controller', () => {
  it('exposes kind-filtered palette entity search at the domain boundary', async () => {
    const searchEntities = vi.fn(async () => [
      {
        kind: 'task' as const,
        id: 'task-1',
        projectId: 'project-1',
        taskId: null,
        title: 'Theme task',
        subtitle: 'THEME-123',
        score: 0,
      },
    ]);
    const service = {
      searchEntities,
      searchFiles: vi.fn(),
      searchContent: vi.fn(),
    } as unknown as SearchService;
    const wire = createTestWire(searchContract, createSearchWireController(service));
    const input = {
      kind: 'task' as const,
      query: 'tt',
      context: { projectId: 'project-1' },
      limit: 50,
    };

    try {
      await expect(wire.client.searchPaletteEntities(input)).resolves.toEqual([
        {
          kind: 'task',
          id: 'task-1',
          projectId: 'project-1',
          taskId: null,
          title: 'Theme task',
          subtitle: 'THEME-123',
          score: 0,
        },
      ]);
      expect(searchEntities).toHaveBeenCalledWith(input);
    } finally {
      await wire.dispose();
    }
  });

  it('exposes canonical resource identity and a workspace-relative coordinate for file hits', async () => {
    const relativePath = portablePath('src/index.ts');
    const resource = encodeResourceUri(
      hostFileRef(hostRef('remote', 'machine-1'), hostPathFromNative('/repo/src/index.ts'))
    );
    const searchFiles = vi.fn(async () => [{ resource, relativePath, filename: 'index.ts' }]);
    const service = {
      searchEntities: vi.fn(),
      searchFiles,
      searchContent: vi.fn(),
    } as unknown as SearchService;
    const wire = createTestWire(searchContract, createSearchWireController(service));

    try {
      await expect(
        wire.client.searchWorkspaceFiles({
          workspaceId: 'workspace-1',
          query: 'index',
          limit: 20,
        })
      ).resolves.toEqual([{ resource, relativePath, filename: 'index.ts' }]);
      expect(searchFiles).toHaveBeenCalledWith('workspace-1', 'index', 20);
    } finally {
      await wire.dispose();
    }
  });
});
