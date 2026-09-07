/**
 * @vitest-environment jsdom
 */
import {
  parsePortableRelativePath,
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import type { FileTreeModel } from '@emdash/core/runtimes/files/api';
import { ok } from '@emdash/shared';
import { waitFor } from '@emdash/shared/testing';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectsWireContract } from '@core/features/projects/api';
import {
  ProjectDirectoryPicker,
  type ProjectDirectoryPickerClient,
} from './project-directory-picker';

const homeRoot: HostAbsolutePath = {
  root: { kind: 'posix' },
  segments: ['home', 'dev'],
};
const repoPathResult = parsePortableRelativePath('repo');
if (!repoPathResult.success) throw new Error(repoPathResult.error.message);
const repoPath = repoPathResult.data;
const testContract = defineContract({ directoryTree: projectsWireContract.directoryTree });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectDirectoryPicker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reveals a remote root once and settles the directory listing', async () => {
    const treeState = cell<FileTreeModel>(treeModel(false));
    const reveal = vi.fn(async (context) => {
      const revision = treeState.set(treeModel(true), {
        mutationIds: [context.mutationId],
      });
      await context.observed('tree', revision);
      return ok(undefined);
    });
    const directoryTree = expose(
      projectsWireContract.directoryTree,
      { tree: treeState },
      {
        mutations: {
          expand: async () => ok(undefined),
          reveal,
        },
      }
    );
    const wire = createTestWire(testContract, { directoryTree });
    const getProjectsClient = async () => wire.client as unknown as ProjectDirectoryPickerClient;
    const props = {
      strategy: 'ssh' as const,
      connectionId: 'machine-1',
      initialPath: '/home/dev',
      homePath: '/home/dev',
      homePending: false,
      homeError: null,
      value: '/home/dev',
      getProjectsClient,
      onSelect: vi.fn(),
    };

    try {
      await act(async () => root.render(createElement(ProjectDirectoryPicker, props)));
      await act(async () => {
        await waitFor(() => container.textContent?.includes('repo') ?? false);
      });

      expect(reveal).toHaveBeenCalledOnce();
      expect(reveal.mock.calls[0]?.[0].input).toEqual({ path: '', depth: 2 });
      expect(container.textContent).not.toContain('Loading folder');

      await act(async () => root.render(createElement(ProjectDirectoryPicker, props)));
      expect(reveal).toHaveBeenCalledOnce();
    } finally {
      await wire.dispose();
      await directoryTree.dispose();
    }
  });
});

function treeModel(revealed: boolean): FileTreeModel {
  return {
    root: homeRoot,
    entries: {
      '': {
        path: ROOT_RELATIVE_PATH,
        name: 'dev',
        parentPath: null,
        kind: 'directory',
        childrenLoaded: revealed,
        children: revealed ? [repoPath] : [],
        hasChildren: revealed,
      },
      ...(revealed
        ? {
            repo: {
              path: repoPath,
              name: 'repo',
              parentPath: ROOT_RELATIVE_PATH,
              kind: 'directory' as const,
              childrenLoaded: true,
              children: [],
              hasChildren: false,
            },
          }
        : {}),
    },
  };
}
