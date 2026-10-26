import type * as uiPrimitivesModule from '@emdash/ui/react/primitives';
import type * as reactQueryModule from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
import type * as modalApiModule from '@core/manifests/browser/modal-api';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import type * as workspacesClientModule from '../../api/browser/client';
import type { JoinedWorkspaceRow } from '../../api/browser/workspace-rows';
import { WorkspaceDetailPage } from './workspace-detail-page';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  cleanArtifacts: vi.fn(),
  invalidateQueries: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

const state = vi.hoisted(() => ({ rows: [] as JoinedWorkspaceRow[] }));

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof uiPrimitivesModule>()),
  toast: mocks.toast,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof reactQueryModule>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@core/manifests/browser/modal-api', async (importOriginal) => ({
  ...(await importOriginal<typeof modalApiModule>()),
  useOpenModal: (name: string) => (name === 'confirmActionModal' ? mocks.confirm : vi.fn()),
}));

vi.mock('../../api/browser/client', async (importOriginal) => ({
  ...(await importOriginal<typeof workspacesClientModule>()),
  getWorkspacesWireClient: async () => ({ cleanArtifacts: mocks.cleanArtifacts }),
}));

vi.mock('../../api/browser/use-workspace-rows', () => ({
  useWorkspaceRows: () => ({
    workspaceQuery: { isLoading: false, isError: false },
    usageQuery: { isLoading: false, isFetching: false },
    rows: state.rows,
    group: { project: { id: 'project-1', name: 'Emdash' }, warnings: [], workspaces: state.rows },
  }),
}));

vi.mock('./repository-header', () => ({ RepositoryHeader: () => null }));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function workspaceRow(overrides: Partial<ProjectWorkspaceRow>): ProjectWorkspaceRow {
  return {
    kind: 'workspace',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    path: '/repos/emdash-feature',
    branch: 'feature',
    tasks: [],
    usage: null,
    gitStats: null,
    pathState: 'measured',
    canCleanArtifacts: true,
    canDelete: true,
    hasActiveSessions: false,
    lastObservedAt: '2026-10-26T00:00:00.000Z',
    pendingRemoval: false,
    errors: [],
    ...overrides,
  };
}

function joined(row: ProjectWorkspaceRow): JoinedWorkspaceRow {
  return {
    row,
    key: row.workspaceId ?? row.path,
    status: 'idle',
    pendingRemoval: false,
    removalNeedsAttention: false,
  };
}

const liveHost = {
  liveAction: { kind: 'enabled' },
  observe: <T,>(observation: { kind: string; value?: T; observedAt?: number }) =>
    observation.kind === 'observed'
      ? { kind: 'fresh', value: observation.value, observedAt: observation.observedAt }
      : { kind: 'unavailable' },
} as unknown as ProjectHostAccess;

describe('WorkspaceDetailPage Clean Artifacts', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.confirm.mockReset().mockResolvedValue({ success: true, data: undefined });
    mocks.cleanArtifacts.mockReset().mockResolvedValue({ success: true, data: {} });
    mocks.invalidateQueries.mockReset();
    mocks.toast.mockReset();
    mocks.toast.error.mockReset();
    state.rows = [
      joined(workspaceRow({ kind: 'root', workspaceId: 'root-1', path: '/repos/emdash' })),
      joined(workspaceRow({})),
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
    host.remove();
  });

  async function cleanFromRowMenu() {
    await act(async () =>
      root.render(
        <WorkspaceDetailPage scope={{ kind: 'local' }} host={liveHost} projectId="project-1" />
      )
    );
    const actions = host.querySelector<HTMLButtonElement>('[aria-label="Actions for feature"]');
    await act(async () => actions?.click());
    const clean = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Clean Artifacts'
    );
    await act(async () => clean?.click());
  }

  it('confirms what is removed and kept, then cleans in place by workspace id', async () => {
    await cleanFromRowMenu();

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const [dialog] = mocks.confirm.mock.calls[0]!;
    expect(dialog).toMatchObject({ confirmLabel: 'Clean Artifacts' });
    expect(dialog.description).toContain('gitignored files');
    expect(dialog.description).toContain('uncommitted changes');
    expect(dialog.description).toContain('local .env files, and');
    expect(dialog.description).toContain("project's preserve patterns");
    expect(dialog.description).toContain('the worktree and its tasks');
    expect(dialog.description).not.toMatch(/teardown|stops/i);
    expect(mocks.cleanArtifacts).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.toast).toHaveBeenCalledWith('Cleaned artifacts for feature');
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    mocks.confirm.mockResolvedValue({ success: false });

    await cleanFromRowMenu();

    expect(mocks.cleanArtifacts).not.toHaveBeenCalled();
  });

  it('shows the host refusal when sessions are running', async () => {
    mocks.cleanArtifacts.mockResolvedValue({
      success: false,
      error: { type: 'workspace-active', message: 'Agents or terminals are running.' },
    });

    await cleanFromRowMenu();

    expect(mocks.toast.error).toHaveBeenCalledWith('Could not clean artifacts', {
      description: 'Agents or terminals are running.',
    });
  });
});
