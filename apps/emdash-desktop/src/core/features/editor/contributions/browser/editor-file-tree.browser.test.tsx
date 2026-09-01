import {
  FileTree,
  type FileTreeHeaderContext,
  type FileTreeNode,
} from '@emdash/ui/react/components';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileTreeGitChangeIndicator,
  FileTreeHeaderBar,
  fileTreeGitStatusTone,
} from './editor-file-tree';
import '@emdash/ui/style.css';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('FileTreeHeaderBar layout', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '720px';
    host.style.height = '240px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('reserves enough inline space for the search icon', async () => {
    const context: FileTreeHeaderContext = {
      targetPath: '',
      startDraft: vi.fn(),
      collapseAll: vi.fn(),
      expandAll: vi.fn(),
    };

    await act(async () => {
      root.render(
        <FileTreeHeaderBar
          context={context}
          searchQuery="const"
          setSearchQuery={vi.fn()}
          setSearchInputRef={vi.fn()}
          onRefresh={vi.fn()}
          isRefreshing={false}
        />
      );
    });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Search"]');
    const icon = input?.parentElement?.querySelector<SVGSVGElement>('svg');
    expect(input).not.toBeNull();
    expect(icon).not.toBeNull();

    const inputBox = input!.getBoundingClientRect();
    const iconBox = icon!.getBoundingClientRect();
    const textStart = inputBox.left + Number.parseFloat(getComputedStyle(input!).paddingLeft);

    expect(textStart).toBeGreaterThanOrEqual(iconBox.right + 2);
    expect(host.querySelector('[aria-label="Clear search"]')).not.toBeNull();
  });

  it('uses compact search geometry in a tab-aligned header row', async () => {
    const context: FileTreeHeaderContext = {
      targetPath: '',
      startDraft: vi.fn(),
      collapseAll: vi.fn(),
      expandAll: vi.fn(),
    };

    await act(async () => {
      root.render(
        <FileTreeHeaderBar
          context={context}
          searchQuery=""
          setSearchQuery={vi.fn()}
          setSearchInputRef={vi.fn()}
          onRefresh={vi.fn()}
          isRefreshing={false}
        />
      );
    });

    const header = host.firstElementChild;
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search"]');
    expect(header).not.toBeNull();
    expect(input).not.toBeNull();

    expect(header).toHaveClass('h-[41px]', 'bg-background-secondary');
    expect(getComputedStyle(input!).height).toBe('24px');
    expect(input).toHaveClass('focus-visible:bg-transparent');
  });
});

describe('FileTree Git decorations', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '400px';
    host.style.height = '240px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('uses the added color for both the parent folder name and bubble', async () => {
    const tooling: FileTreeNode = {
      id: 'tooling',
      path: '/repo/tooling',
      name: 'tooling',
      parentId: null,
      parentPath: '/repo',
      depth: 0,
      type: 'directory',
      childrenLoaded: true,
    };

    await act(async () => {
      root.render(
        <FileTree
          rootPath="/repo"
          rootNodes={[tooling]}
          childrenById={new Map([['tooling', []]])}
          renderHeader={() => null}
          getRowState={() => ({ tone: fileTreeGitStatusTone('added') })}
          renderDecoration={() => <FileTreeGitChangeIndicator status="added" />}
        />
      );
    });

    const folderName = host.querySelector<HTMLElement>('[data-tone="success"]');
    const bubble = host.querySelector<HTMLElement>('[aria-label="Contains emphasized items"]');
    expect(folderName).not.toBeNull();
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveStyle({ color: 'var(--em-foreground-success)' });
    expect(getComputedStyle(folderName!).color).toBe(getComputedStyle(bubble!).color);
  });
});
