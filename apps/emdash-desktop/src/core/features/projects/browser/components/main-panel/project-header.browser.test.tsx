import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectHeader } from './project-header';

const mocks = vi.hoisted(() => ({
  confirmDeleteProject: vi.fn(),
  openExternal: vi.fn(),
  openRenameProject: vi.fn(),
}));

const state = vi.hoisted(() => ({
  project: {
    type: 'local' as 'local' | 'ssh',
    id: 'project-1',
    name: 'Emdash',
    path: '/repos/emdash',
    baseRef: 'main',
    repositoryWorkspaceId: null,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    connectionId: undefined as string | undefined,
  },
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectStore: () => ({ data: state.project, name: state.project.name }),
  projectDisplayName: () => state.project.name,
}));

vi.mock('@core/features/projects/contributions/browser/use-confirm-delete-project', () => ({
  useConfirmDeleteProject: () => mocks.confirmDeleteProject,
}));

vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => mocks.openRenameProject,
}));

vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => ({
    baseRemote: { url: 'https://github.com/emdash-ai/emdash.git' },
    canonicalRepositoryUrl: 'https://github.com/emdash-ai/emdash',
  }),
}));

vi.mock('@core/features/settings/contributions/browser/open-in-menu', () => ({
  OpenInMenu: ({
    path,
    isRemote,
    sshConnectionId,
  }: {
    path: string;
    isRemote: boolean;
    sshConnectionId?: string;
  }) => (
    <button
      type="button"
      aria-label="Open In"
      data-path={path}
      data-remote={String(isRemote)}
      data-connection={sshConnectionId}
    />
  ),
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  openExternal: mocks.openExternal,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectHeader', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.confirmDeleteProject.mockReset();
    mocks.openExternal.mockReset();
    mocks.openRenameProject.mockReset();
    state.project.type = 'local';
    state.project.connectionId = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
    host.remove();
  });

  it('shows local Project identity and preserves repository, Open In, and remove actions', async () => {
    await act(async () => root.render(<ProjectHeader projectId="project-1" />));

    expect(host.querySelector('h1')?.textContent).toBe('Emdash');
    const identityIcon = host.querySelector('[data-severity="neutral"]');
    expect(identityIcon?.querySelector('.lucide-folder-open')).not.toBeNull();
    expect(host.querySelector('.lucide-folder-input')).toBeNull();

    const repository = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('emdash-ai/emdash')
    );
    await act(async () => repository?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/emdash-ai/emdash');

    const openIn = host.querySelector<HTMLButtonElement>('[aria-label="Open In"]');
    expect(openIn?.dataset.path).toBe('/repos/emdash');
    expect(openIn?.dataset.remote).toBe('false');

    const actions = host.querySelector<HTMLButtonElement>('[aria-label="Project actions"]');
    await act(async () => actions?.click());
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Remove Project'
    );
    await act(async () => remove?.click());
    expect(mocks.confirmDeleteProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectLabel: 'Emdash',
    });
  });

  it('opens the rename modal with the current name from the actions menu', async () => {
    await act(async () => root.render(<ProjectHeader projectId="project-1" />));

    const actions = host.querySelector<HTMLButtonElement>('[aria-label="Project actions"]');
    await act(async () => actions?.click());
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Rename Project'
    );
    expect(rename).not.toBeUndefined();
    await act(async () => rename?.click());
    expect(mocks.openRenameProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      currentName: 'Emdash',
    });
    expect(mocks.confirmDeleteProject).not.toHaveBeenCalled();
  });

  it('uses the remote Project icon and SSH Open In target', async () => {
    state.project.type = 'ssh';
    state.project.connectionId = 'machine-1';

    await act(async () => root.render(<ProjectHeader projectId="project-1" />));

    const identityIcon = host.querySelector('[data-severity="neutral"]');
    expect(identityIcon?.querySelector('.lucide-folder-input')).not.toBeNull();
    expect(host.querySelector('.lucide-folder-open')).toBeNull();
    const openIn = host.querySelector<HTMLButtonElement>('[aria-label="Open In"]');
    expect(openIn?.dataset.remote).toBe('true');
    expect(openIn?.dataset.connection).toBe('machine-1');
  });
});
