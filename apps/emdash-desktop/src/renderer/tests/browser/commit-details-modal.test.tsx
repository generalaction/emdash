import '@emdash/ui/style.css';
import type { Commit, GitChange } from '@emdash/core/runtimes/git/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitContextMenu } from '@core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/commit-context-menu';
import { commitFilesQueryKey } from '@core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/use-commit-files';
import { openModal } from '@core/manifests/browser/modal-api';
import { modalStore } from '@core/primitives/modals/react/modal-store';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';

// Test fixtures only need the brand, not real path validation.
const gitPath = (path: string) => path as GitChange['path'];

const commit: Commit = {
  hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  parents: ['0123456789abcdef0123456789abcdef01234567'],
  subject: 'feat(scope): add the commit details modal',
  body: 'Longer explanation of the change.\n\n- first detail\n- second detail',
  author: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  date: Date.UTC(2026, 0, 15, 12, 30),
  committer: 'Grace Hopper',
  committerEmail: 'grace@example.com',
  committerDate: Date.UTC(2026, 0, 16, 9, 0),
  isPushed: false,
  tags: ['v1.2.3'],
};

const commitFiles: GitChange[] = [
  { path: gitPath('src/feature/thing.ts'), status: 'modified', additions: 12, deletions: 3 },
  { path: gitPath('src/feature/created.ts'), status: 'added', additions: 40, deletions: 0 },
];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

async function flushOpen() {
  // Let Base UI mount the popup and run its initial-focus pass.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('commit context menu', () => {
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

  it('opens on right-click with details and copy actions', async () => {
    const onViewDetails = vi.fn();
    await act(async () => {
      root.render(
        <ThemeProvider theme="emlight" onThemeChange={vi.fn()}>
          <CommitContextMenu commit={commit} onViewDetails={onViewDetails}>
            <button>{commit.subject}</button>
          </CommitContextMenu>
        </ThemeProvider>
      );
    });

    const trigger = host.querySelector('button');
    expect(trigger).not.toBeNull();
    const rect = trigger!.getBoundingClientRect();
    await act(async () => {
      trigger!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + 4,
          clientY: rect.y + 4,
        })
      );
    });
    await flushOpen();

    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="context-menu-item"]')
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'View commit details',
      'Copy commit SHA',
      'Copy commit message',
    ]);

    await act(async () => items[0]!.click());
    expect(onViewDetails).toHaveBeenCalledOnce();
  });
});

describe('commit details modal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    queryClient = new QueryClient();
  });

  afterEach(async () => {
    for (const entry of [...modalStore.stack]) modalStore.removeEntry(entry.key);
    queryClient.clear();
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders the full message, identities, metadata, and file stats', async () => {
    // Seed the files query so the modal renders without a wire connection; the
    // query's 5-minute staleTime keeps the seeded data from being refetched.
    queryClient.setQueryData(
      commitFilesQueryKey('project-1', 'workspace-1', commit.hash),
      commitFiles
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme="emlight" onThemeChange={vi.fn()}>
            <ModalRenderer />
          </ThemeProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      void openModal('commitDetailsModal', {
        commit,
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      });
    });
    await flushOpen();

    const popup = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    expect(popup).not.toBeNull();
    const text = popup!.textContent ?? '';

    expect(text).toContain(commit.subject);
    expect(text).toContain('Longer explanation of the change.');
    expect(text).toContain('Ada Lovelace <ada@example.com>');
    expect(text).toContain('Grace Hopper <grace@example.com>');
    expect(text).toContain(commit.hash);
    expect(text).toContain('0123456');
    expect(text).toContain('v1.2.3');
    expect(text).toContain('Local only');
    expect(text).toContain('2 files changed');
    expect(text).toContain('thing.ts');
    expect(text).toContain('created.ts');
    expect(text).toContain('+12');
    expect(text).toContain('-3');
    expect(text).toContain('Copy SHA');
    expect(text).toContain('Copy message');

    // The file list is display-only: no interactive elements inside it.
    const fileList = popup!.querySelector('ul');
    expect(fileList).not.toBeNull();
    expect(fileList!.querySelector('button, a')).toBeNull();
  });

  it('falls back to a placeholder when the commit has no body', async () => {
    const bodylessCommit: Commit = { ...commit, hash: 'b'.repeat(40), body: '' };
    queryClient.setQueryData(
      commitFilesQueryKey('project-1', 'workspace-1', bodylessCommit.hash),
      []
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme="emlight" onThemeChange={vi.fn()}>
            <ModalRenderer />
          </ThemeProvider>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      void openModal('commitDetailsModal', {
        commit: bodylessCommit,
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      });
    });
    await flushOpen();

    const text = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')?.textContent;
    expect(text).toContain('This commit has no message body beyond its subject.');
    expect(text).toContain('No file changes.');
  });
});
