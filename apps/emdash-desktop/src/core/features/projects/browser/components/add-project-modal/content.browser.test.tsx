import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
          onConnectGithub={vi.fn()}
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
});
