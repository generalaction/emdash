import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { CreateRepositoryPanel } from './content';
import type { CreateRepositoryModeState } from './modes';
import type { ProjectDirectoryPickerClient } from './project-directory-picker';

describe('CreateRepositoryPanel layout', () => {
  let container: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = `
      @layer utilities {
        .flex { display: flex; }
        .grid { display: grid; }
        .flex-col { flex-direction: column; }
        .flex-1 { flex: 1 1 0%; }
        .items-end { align-items: flex-end; }
        .gap-2 { gap: 0.5rem; }
        .gap-6 { gap: 1.5rem; }
        .min-w-0 { min-width: 0; }
        [class~='w-1/4'] { width: 25%; }
        [class~='grid-cols-[minmax(0,1fr)_auto_minmax(0,3fr)]'] {
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 3fr);
        }
      }
    `;
    document.head.append(style);

    container = document.createElement('div');
    container.style.width = '800px';
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    style.remove();
  });

  it('keeps the owner and repository name fields within the row', () => {
    const owner = { value: 'octocat', label: 'octocat', avatarUrl: '' };
    const state: CreateRepositoryModeState = {
      repositoryName: '',
      repositoryOwner: owner,
      repositoryVisibility: 'private',
      owners: [owner],
      repositoryOwnersErrorMessage: null,
      setRepositoryVisibility: vi.fn(),
      path: '/tmp/projects',
      setPath: vi.fn(),
      handleRepositoryNameChange: vi.fn(),
      handleOwnerChange: vi.fn(),
      isValid: false,
    };
    const getProjectsClient = vi.fn<() => Promise<ProjectDirectoryPickerClient>>();

    act(() => {
      root.render(
        <CreateRepositoryPanel
          strategy="local"
          state={state}
          getProjectsClient={getProjectsClient}
          accounts={[]}
          selectedAccount={null}
          defaultAccount={null}
          onAccountChange={vi.fn()}
          onConnectProvider={vi.fn()}
          provider="github"
          onProviderChange={vi.fn()}
          ensureDefaultRoot={false}
        />
      );
    });

    const ownerControl = container.querySelector<HTMLElement>('[aria-label="Repository owner"]');
    const repositoryInput = container.querySelector<HTMLElement>(
      '[placeholder="Enter a repository name"]'
    );
    const ownerField = ownerControl?.closest<HTMLElement>('[data-slot="field"]');
    const repositoryField = repositoryInput?.closest<HTMLElement>('[data-slot="field"]');
    const row = ownerField?.parentElement;

    expect(ownerField).not.toBeNull();
    expect(repositoryField).not.toBeNull();
    expect(row).not.toBeNull();

    const ownerBox = ownerField!.getBoundingClientRect();
    const repositoryBox = repositoryField!.getBoundingClientRect();
    const rowBox = row!.getBoundingClientRect();

    expect(ownerBox.width).toBeGreaterThan(150);
    expect(repositoryBox.width).toBeGreaterThan(500);
    expect(repositoryBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);
  });

  it('offers GitLab as a repository provider', async () => {
    const onProviderChange = vi.fn();
    const owner = { value: 'parent/nested', label: 'parent/nested', avatarUrl: '' };
    const state: CreateRepositoryModeState = {
      repositoryName: 'repo',
      repositoryOwner: owner,
      repositoryVisibility: 'private',
      owners: [owner],
      repositoryOwnersErrorMessage: null,
      setRepositoryVisibility: vi.fn(),
      path: '/tmp/projects',
      setPath: vi.fn(),
      handleRepositoryNameChange: vi.fn(),
      handleOwnerChange: vi.fn(),
      isValid: true,
    };
    await act(async () =>
      root.render(
        <CreateRepositoryPanel
          strategy="local"
          state={state}
          getProjectsClient={vi.fn()}
          accounts={[]}
          selectedAccount={null}
          defaultAccount={null}
          onAccountChange={vi.fn()}
          onConnectProvider={vi.fn()}
          provider="gitlab"
          onProviderChange={onProviderChange}
          ensureDefaultRoot={false}
        />
      )
    );
    await expect.element(page.getByText('GitLab', { exact: true }).first()).toBeVisible();
    const providerTrigger = container.querySelector<HTMLElement>(
      '[aria-label="Repository provider"]'
    );
    expect(providerTrigger).not.toBeNull();
    await act(async () => providerTrigger!.click());
    await act(async () => page.getByRole('option', { name: 'GitHub' }).click());
    expect(onProviderChange).toHaveBeenCalledWith('github');
  });

  it('explains that a GitLab group path belongs in Owner', async () => {
    const owner = { value: 'parent/nested', label: 'parent/nested', avatarUrl: '' };
    const state: CreateRepositoryModeState = {
      repositoryName: 'nested/fun/excitement',
      repositoryOwner: owner,
      repositoryVisibility: 'private',
      owners: [owner],
      repositoryOwnersErrorMessage: null,
      setRepositoryVisibility: vi.fn(),
      path: '/tmp/projects',
      setPath: vi.fn(),
      handleRepositoryNameChange: vi.fn(),
      handleOwnerChange: vi.fn(),
      isValid: false,
    };
    await act(async () =>
      root.render(
        <CreateRepositoryPanel
          strategy="local"
          state={state}
          getProjectsClient={vi.fn()}
          accounts={[]}
          selectedAccount={null}
          defaultAccount={null}
          onAccountChange={vi.fn()}
          onConnectProvider={vi.fn()}
          provider="gitlab"
          onProviderChange={vi.fn()}
          ensureDefaultRoot={false}
        />
      )
    );
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(
        'Project creation is limited to existing groups and subgroups. Select one in Owner and enter only the project name here.'
      );
    expect(container.querySelector('[placeholder="Enter a repository name"]')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    const ownerField = container
      .querySelector<HTMLElement>('[aria-label="Repository owner"]')
      ?.closest<HTMLElement>('[data-slot="field"]');
    const repositoryField = container
      .querySelector<HTMLElement>('[placeholder="Enter a repository name"]')
      ?.closest<HTMLElement>('[data-slot="field"]');
    const error = container.querySelector<HTMLElement>('[role="alert"]');
    expect(ownerField).not.toBeNull();
    expect(repositoryField).not.toBeNull();
    expect(error).not.toBeNull();
    expect(
      Math.abs(
        ownerField!.getBoundingClientRect().top - repositoryField!.getBoundingClientRect().top
      )
    ).toBeLessThan(1);
    expect(error!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      repositoryField!.getBoundingClientRect().bottom
    );
  });
});
