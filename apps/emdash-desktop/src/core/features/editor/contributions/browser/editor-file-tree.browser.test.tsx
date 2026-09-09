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
    const toolbar = host.firstElementChild;
    expect(input).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(getComputedStyle(toolbar!).borderBottomStyle).toBe('solid');

    const inputBox = input!.getBoundingClientRect();
    const iconBox = icon!.getBoundingClientRect();
    const textStart = inputBox.left + Number.parseFloat(getComputedStyle(input!).paddingLeft);

    expect(textStart).toBeGreaterThanOrEqual(iconBox.right + 2);
    expect(host.querySelector('[aria-label="Clear search"]')).not.toBeNull();
  });

  it('aligns search content with root folder rows', async () => {
    const context: FileTreeHeaderContext = {
      targetPath: '',
      startDraft: vi.fn(),
      collapseAll: vi.fn(),
      expandAll: vi.fn(),
    };
    const folder: FileTreeNode = {
      id: 'src',
      path: '/repo/src',
      name: 'src',
      parentId: null,
      parentPath: '/repo',
      depth: 0,
      type: 'directory',
      childrenLoaded: true,
    };

    await act(async () => {
      root.render(
        <div className="flex h-full flex-col">
          <FileTreeHeaderBar
            context={context}
            searchQuery=""
            setSearchQuery={vi.fn()}
            setSearchInputRef={vi.fn()}
            onRefresh={vi.fn()}
            isRefreshing={false}
          />
          <FileTree
            rootPath="/repo"
            rootNodes={[folder]}
            childrenById={new Map([['src', []]])}
            renderHeader={() => null}
          />
        </div>
      );
    });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Search"]');
    const searchIcon = input?.parentElement?.querySelector<SVGSVGElement>('svg');
    const folderRow = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'src'
    );
    const folderChevron = folderRow?.querySelector<SVGSVGElement>('svg');
    const folderName = Array.from(folderRow?.querySelectorAll<HTMLElement>('span') ?? []).find(
      (span) => span.textContent === 'src' && span.children.length === 0
    );
    expect(input).not.toBeNull();
    expect(searchIcon).not.toBeNull();
    expect(folderChevron).toBeDefined();
    expect(folderName).toBeDefined();

    expect(getComputedStyle(input!).height).toBe('24px');
    expect(searchIcon!.getBoundingClientRect().left).toBeCloseTo(
      folderChevron!.getBoundingClientRect().left,
      0
    );
    const searchTextLeft =
      input!.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(input!).paddingLeft);
    expect(searchTextLeft).toBeCloseTo(folderName!.getBoundingClientRect().left, 0);
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
