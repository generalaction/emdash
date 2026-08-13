import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    children?: ReactNode,
    onRecover: () => Promise<ReturnType<typeof ok<void>>> = async () => ok<void>()
  ): Promise<void> {
    await act(async () => {
      root.render(
        children ? (
          <ProjectAvailabilityFrame
            project={project}
            state={state}
            machineName="Orion"
            onRecover={onRecover}
          >
            {children}
          </ProjectAvailabilityFrame>
        ) : (
          <ProjectAvailabilityBanner
            project={project}
            state={state}
            machineName="Orion"
            onRecover={onRecover}
          />
        )
      );
    });
  }

  it('offers only Retry for local runtime recovery', async () => {
    const recover = vi.fn(async () => ok<void>());
    await render(localProject, { kind: 'offline' }, undefined, recover);

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Local runtime is unavailable');
    expect(status?.textContent).toContain('Project data remains available');
    expect(status?.textContent).not.toContain('Connect');
    expect(status?.textContent).not.toContain('Open Machines');

    const retry = status?.querySelector('button');
    expect(retry?.textContent).toBe('Retry');
    await act(async () => retry?.click());
    expect(recover).toHaveBeenCalledOnce();
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
    expect(status?.querySelector('button')?.textContent).toBe('Connect');
    expect(status?.compareDocumentPosition(content!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([
    [{ kind: 'preparing', phase: 'connecting' }, 'Connecting to Orion'],
    [{ kind: 'preparing', phase: 'provisioning' }, 'Preparing Orion'],
    [{ kind: 'preparing', phase: 'handshaking' }, 'Preparing Orion'],
    [{ kind: 'attaching' }, 'Opening Project on Orion'],
  ] as const)('announces %s progress politely', async (state, title) => {
    await render(sshProject, state);

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain(title);
    expect(status?.getAttribute('aria-live')).toBe('polite');
    const action = status?.querySelector('button');
    expect(action?.textContent).toBe('Connect');
    expect(action?.getAttribute('aria-disabled')).toBe('true');
    const descriptionId = action?.getAttribute('aria-describedby');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('already in progress');
  });

  it('shows automatic recovery progress with an explicit Retry now action', async () => {
    await render(sshProject, { kind: 'recovering', nextAttemptAt: 12_000 });

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Reconnecting to Orion');
    expect(status?.textContent).toContain('Automatic recovery is in progress');
    const retry = status?.querySelector('button');
    expect(retry?.textContent).toBe('Retry now');
    expect(retry?.getAttribute('aria-disabled')).toBe('false');
  });

  it('announces exhausted automatic recovery as a manual Retry', async () => {
    await render(sshProject, {
      kind: 'offline',
      recovery: 'manual',
      automaticExhausted: true,
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Automatic recovery stopped');
    const retry = alert?.querySelector('button');
    expect(retry?.textContent).toBe('Retry');
    expect(retry?.getAttribute('aria-disabled')).toBe('false');
  });

  it('does not claim six attempts for an immediately manual recovery outcome', async () => {
    await render(sshProject, { kind: 'offline', recovery: 'manual' });

    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('six attempts');
  });

  it('keeps focus and joins repeated clicks while recovery is acknowledged', async () => {
    const request = deferred<ReturnType<typeof ok<void>>>();
    const recover = vi.fn(() => request.promise);
    await render(sshProject, { kind: 'offline' }, undefined, recover);
    const button = host.querySelector('button');
    button?.focus();

    await act(async () => {
      button?.click();
      button?.click();
    });

    expect(recover).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    const descriptionId = button?.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('already in progress');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Orion is offline');

    await render(sshProject, { kind: 'preparing', phase: 'connecting' }, undefined, recover);
    expect(document.activeElement).toBe(host.querySelector('button'));

    request.resolve(ok<void>());
    await act(async () => await request.promise);

    expect(host.querySelector('[role="status"]')?.textContent).toContain('Connecting to Orion');
    expect(host.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders no banner or reserved space when Host access is ready', async () => {
    await render(sshProject, { kind: 'ready', hostGeneration: 2 });

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toBe('');
  });
});
