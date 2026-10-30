import { encodeResourceUri, type HostFileRef } from '@emdash/core/primitives/path/api';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { HEAD_REF } from '@core/primitives/git/api';
import { usePrefetchDiffModels } from './use-prefetch-diff-models';

const boundary = vi.hoisted(() => ({
  workspace: {
    workspaceId: 'worktree',
    path: '/repo/original',
    sshConnectionId: undefined as string | undefined,
  },
  acquire: vi.fn(),
}));

vi.mock('@core/features/workbench/api/browser/task-composition-context', () => ({
  useWorkspace: () => boundary.workspace,
  useTaskComposition: () => ({ diffView: { workspace: boundary.workspace } }),
}));
vi.mock('@core/features/editor/api/browser/open-file-store/open-file-store', () => ({
  openFileStore: { acquire: boundary.acquire },
}));

function PrefetchControl() {
  const prefetch = usePrefetchDiffModels('disk', HEAD_REF);
  return <button onClick={() => prefetch('shared.txt')}>Warm diff</button>;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  boundary.workspace = {
    workspaceId: 'worktree',
    path: '/repo/original',
    sshConnectionId: undefined,
  };
  boundary.acquire.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it.each([
  { name: 'path', next: { path: '/repo/moved' } },
  { name: 'connection', next: { sshConnectionId: 'new-host' } },
])(
  'releases stale prefetch leases when the checkout $name changes without changing its ID',
  async ({ next }) => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    boundary.acquire.mockImplementation(() => {
      const release = vi.fn();
      releases.push(release);
      return { entry: {}, release };
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = () => act(async () => root.render(<PrefetchControl />));
    const warm = () => act(async () => host.querySelector('button')?.click());
    try {
      await render();
      await warm();
      await warm();
      expect(boundary.acquire).toHaveBeenCalledTimes(2);
      boundary.workspace = { ...boundary.workspace, ...next };
      await render();
      expect(releases[0]).toHaveBeenCalledOnce();
      expect(releases[1]).toHaveBeenCalledOnce();
      await warm();
      expect(boundary.acquire).toHaveBeenCalledTimes(4);
      const latest = boundary.acquire.mock.calls
        .slice(2)
        .map(([ref]) => encodeResourceUri(ref as HostFileRef));
      const expected = encodeResourceUri(
        hostFileRefFromNativePath(
          `${boundary.workspace.path}/shared.txt`,
          boundary.workspace.sshConnectionId
        )
      );
      expect(latest).toEqual([expected, expected]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);
