import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import { ProjectAvailabilityBanner, ProjectAvailabilityFrame } from './project-availability-banner';

const localProject: LocalProject = {
  type: 'local',
  id: 'local-project',
  name: 'Local Project',
  path: '/project',
  baseRef: 'main',
  repositoryWorkspaceId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const sshProject: SshProject = {
  type: 'ssh',
  id: 'ssh-project',
  name: 'SSH Project',
  path: '/project',
  baseRef: 'main',
  connectionId: 'ssh-1',
  repositoryWorkspaceId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectAvailabilityBanner', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(
    project: LocalProject | SshProject,
    state: ProjectHostAccessState,
    children?: ReactNode
  ): Promise<void> {
    await act(async () => {
      root.render(
        children ? (
          <ProjectAvailabilityFrame project={project} state={state} machineName="Orion">
            {children}
          </ProjectAvailabilityFrame>
        ) : (
          <ProjectAvailabilityBanner project={project} state={state} machineName="Orion" />
        )
      );
    });
  }

  it('uses local runtime copy without an SSH action', async () => {
    await render(localProject, { kind: 'offline' });

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Local runtime is unavailable');
    expect(status?.textContent).toContain('Project data remains available');
    expect(status?.querySelector('button')).toBeNull();
  });

  it('uses the SSH Machine name and keeps the banner above Project content', async () => {
    await render(
      sshProject,
      { kind: 'offline' },
      <main data-testid="project-content">Project navigation and tabs</main>
    );

    const status = host.querySelector('[role="status"]');
    const content = host.querySelector('[data-testid="project-content"]');
    expect(status?.textContent).toContain('Orion is offline');
    expect(status?.compareDocumentPosition(content!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('announces connecting and attaching progress politely', async () => {
    await render(sshProject, { kind: 'preparing', phase: 'connecting' });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Connecting to Orion');

    await render(sshProject, { kind: 'attaching' });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Opening Project on Orion'
    );
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('renders no banner or reserved space when Host access is ready', async () => {
    await render(sshProject, { kind: 'ready', hostGeneration: 2 });

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toBe('');
  });
});
