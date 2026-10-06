import {
  FileTree,
  type FileTreeHandle,
  type FileTreeNode,
  type FileTreeProps,
} from '@emdash/ui/react/components';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@emdash/ui/style.css';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function node(relative: string, type: FileTreeNode['type'] = 'file'): FileTreeNode {
  const parent = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
  return {
    id: relative,
    path: `/repo/${relative}`,
    name: relative.split('/').at(-1)!,
    type,
    parentId: parent || null,
    parentPath: `/repo${parent ? `/${parent}` : ''}`,
    depth: relative.split('/').length - 1,
  };
}

describe('file tree browser interactions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: FileTreeProps;
  const ref = createRef<FileTreeHandle>();

  beforeEach(() => {
    host = document.createElement('div');
    Object.assign(host.style, { width: '480px', height: '300px' });
    document.body.append(host);
    root = createRoot(host);
    props = {
      rootPath: '/repo',
      rootNodes: [node('src', 'directory'), node('README.md')],
      childrenById: new Map([['src', [node('src/app.ts'), node('src/test.ts')]]]),
      renderHeader: () => null,
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(patch: Partial<FileTreeProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => {
      root.render(<FileTree {...props} ref={ref} />);
    });
  }
  function button(name: string): HTMLButtonElement {
    const found = [...host.querySelectorAll('button')].find(
      (element) => element.textContent === name
    );
    if (!found) throw new Error(`Missing row ${name}. Visible: ${host.textContent}`);
    return found;
  }
  async function click(name: string, options: MouseEventInit = {}) {
    await act(async () => {
      button(name).dispatchEvent(new MouseEvent('click', { bubbles: true, ...options }));
    });
  }

  it.each([
    { patch: { isLoading: true }, text: 'Loading files' },
    { patch: { error: 'Disconnected' }, text: 'Disconnected' },
    { patch: { rootNodes: [] }, text: 'Empty folder' },
  ])('shows the $text state', async ({ patch, text }) => {
    await render(patch);
    expect(host.textContent).toContain(text);
  });

  it('expands and collapses a folder without opening an editor', async () => {
    const onOpenFile = vi.fn();
    await render({ onOpenFile });
    await click('src');
    expect(button('src').getAttribute('aria-expanded')).toBe('true');
    expect(button('app.ts')).toBeDefined();
    await click('src');
    expect(button('src').getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('app.ts');
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('keeps a user-expanded folder open when its lazy children arrive', async () => {
    await render({
      childrenById: new Map(),
      rootNodes: [node('src', 'directory')],
    });
    await click('src');
    await render({
      rootNodes: [node('src', 'directory')],
      childrenById: new Map([['src', [node('src/arrived.ts')]]]),
    });
    expect(button('src').getAttribute('aria-expanded')).toBe('true');
    expect(button('arrived.ts')).toBeDefined();
  });

  it('retries an expanded failed folder with one click and keeps it expanded', async () => {
    const onRequestExpand = vi.fn();
    const onToggleExpand = vi.fn();
    await render({
      childrenById: new Map(),
      expandedPaths: new Set(['/repo/src']),
      getRowState: (entry) => (entry.name === 'src' ? { loadError: 'Read timed out' } : undefined),
      onRequestExpand,
      onToggleExpand,
    });
    expect(button('srcRetry').title).toBe('Read timed out');
    await click('srcRetry');
    expect(onRequestExpand).toHaveBeenCalledExactlyOnceWith('/repo/src');
    expect(onToggleExpand).not.toHaveBeenCalled();
    await render({
      getRowState: () => undefined,
      childrenById: new Map([['src', [node('src/recovered.ts')]]]),
    });
    expect(button('recovered.ts')).toBeDefined();
    expect(host.textContent).not.toContain('Retry');
  });

  it('previews on single click and pins on double click', async () => {
    const onOpenFile = vi.fn();
    await render({ onOpenFile });
    await click('README.md');
    expect(onOpenFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: '/repo/README.md' }),
      { preview: true }
    );
    await act(async () => {
      button('README.md').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onOpenFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: '/repo/README.md' }),
      { preview: false }
    );
  });

  it.each(['ctrlKey', 'metaKey', 'shiftKey'] as const)(
    'selects with %s without opening a file',
    async (modifier) => {
      const onOpenFile = vi.fn();
      const onSelectionChange = vi.fn();
      await render({ onOpenFile, onSelectionChange });
      await click('README.md', { [modifier]: true });
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onSelectionChange).toHaveBeenCalled();
    }
  );

  it('expands all compacted path segments so their children become visible', async () => {
    const toggle = vi.fn();
    await render({
      rootNodes: [node('src', 'directory')],
      compactChains: true,
      childrenById: new Map([
        ['src', [node('src/deep', 'directory')]],
        ['src/deep', [node('src/deep/file.ts')]],
      ]),
      onToggleExpand: toggle,
    });
    await click('src/deep');
    expect(toggle.mock.calls.map(([entry]) => entry.path)).toEqual(['/repo/src', '/repo/src/deep']);
    expect(button('file.ts')).toBeDefined();
  });

  it('keeps a compacted row open when its lazily loaded folder holds a single subfolder', async () => {
    const toggle = vi.fn();
    await render({
      rootNodes: [node('src', 'directory')],
      compactChains: true,
      childrenById: new Map([['src', [node('src/deep', 'directory')]]]),
      onToggleExpand: toggle,
    });
    await click('src/deep');
    expect(button('src/deep').getAttribute('aria-expanded')).toBe('true');

    await render({
      childrenById: new Map([
        ['src', [node('src/deep', 'directory')]],
        ['src/deep', [node('src/deep/inner', 'directory')]],
      ]),
    });
    expect(button('src/deep/inner').getAttribute('aria-expanded')).toBe('true');

    // Collapsing closes every folder of the chain, so it stays closed as the chain grows.
    toggle.mockClear();
    await click('src/deep/inner');
    expect(toggle.mock.calls.map(([entry, expanded]) => [entry.path, expanded])).toEqual([
      ['/repo/src', false],
      ['/repo/src/deep', false],
      ['/repo/src/deep/inner', false],
    ]);
    await render({
      childrenById: new Map([
        ['src', [node('src/deep', 'directory')]],
        ['src/deep', [node('src/deep/inner', 'directory')]],
        ['src/deep/inner', [node('src/deep/inner/leaf', 'directory')]],
      ]),
    });
    expect(button('src/deep/inner/leaf').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps folder links out of compacted rows', async () => {
    await render({
      rootNodes: [node('src', 'directory')],
      compactChains: true,
      expandedPaths: new Set(['/repo/src']),
      childrenById: new Map([
        ['src', [{ ...node('src/link', 'symlink'), symlinkTargetKind: 'directory' as const }]],
      ]),
    });
    expect(button('src').getAttribute('aria-expanded')).toBe('true');
    expect(button('link')).toBeDefined();
  });

  it('shows a root draft while a nested item is selected', async () => {
    await render({ selectedPath: '/repo/src/app.ts', expandedPaths: new Set(['/repo/src']) });
    await act(async () => {
      ref.current!.startDraft('file', '/repo');
    });
    const draft = host.querySelector('input');
    expect(draft).not.toBeNull();
    // Root drafts render before the first root row.
    expect(
      draft!.compareDocumentPosition(button('src')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await render({ selectedPath: '/repo/README.md' });
    expect(host.querySelector('input')).toBe(draft);
  });

  it('expands a folder after hovering it during a drag even as dragover keeps firing', async () => {
    const toggle = vi.fn();
    await render({
      childrenById: new Map([['src', [node('src/app.ts')]]]),
      onToggleExpand: toggle,
      dnd: { onMove: vi.fn(), onDropExternal: vi.fn() },
    });
    const hoverFor = async (name: string, ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        await act(async () => {
          button(name).dispatchEvent(
            new DragEvent('dragover', {
              bubbles: true,
              cancelable: true,
              dataTransfer: new DataTransfer(),
            })
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    // Moving on before the delay elapses cancels the pending expansion.
    await hoverFor('src', 300);
    await hoverFor('README.md', 400);
    expect(toggle).not.toHaveBeenCalled();

    await hoverFor('src', 700);
    expect(toggle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '/repo/src' }),
      true
    );
  });

  it.each(['file', 'directory'] as const)(
    'creates a %s from an inline draft exactly once',
    async (kind) => {
      const create = vi.fn();
      await render({ onCreateFile: create, onCreateDirectory: create });
      await act(async () => {
        ref.current!.startDraft(kind);
      });
      await userEvent.fill(page.getByRole('textbox'), 'created');
      await userEvent.keyboard('{Enter}');
      expect(create).toHaveBeenCalledExactlyOnceWith('/repo', 'created');
      expect(host.querySelector('input')).toBeNull();
    }
  );

  it('cancels a draft with Escape', async () => {
    const create = vi.fn();
    await render({ onCreateFile: create });
    await act(async () => {
      ref.current!.startDraft('file');
    });
    await userEvent.fill(page.getByRole('textbox'), 'cancelled.ts');
    await userEvent.keyboard('{Escape}');
    expect(create).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBeNull();
  });

  it('submits a rename with the original node identity', async () => {
    const rename = vi.fn();
    await render({ renamePath: '/repo/README.md', onRenameSubmit: rename });
    await userEvent.fill(page.getByRole('textbox'), 'renamed.md');
    await userEvent.keyboard('{Enter}');
    expect(rename).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '/repo/README.md' }),
      'renamed.md'
    );
  });

  it('virtualizes thousands of files and reveals a distant row', async () => {
    const rootNodes = Array.from({ length: 10000 }, (_, index) => node(`file-${index}.ts`));
    await render({ rootNodes, childrenById: new Map() });
    expect(host.querySelectorAll('button').length).toBeLessThan(50);
    await act(async () => {
      ref.current!.scrollToPath('/repo/file-9000.ts');
    });
    await vi.waitFor(() => expect(button('file-9000.ts')).toBeDefined());
    expect(host.querySelectorAll('button').length).toBeLessThan(50);
  });

  it('keeps UNC paths intact when toggling expansion', async () => {
    const toggle = vi.fn();
    await render({
      rootPath: '//server/share',
      rootNodes: [
        { ...node('src', 'directory'), path: '//server/share/src', parentPath: '//server/share' },
      ],
      childrenById: new Map(),
      expandedPaths: new Set(['//server/share/src']),
      onToggleExpand: toggle,
    });
    expect(button('src').getAttribute('aria-expanded')).toBe('true');
    await click('src');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '//server/share/src' }),
      false
    );
  });
});
