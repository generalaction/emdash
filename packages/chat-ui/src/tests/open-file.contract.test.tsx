/**
 * open-file command — browser contract tests.
 *
 * Verifies that clicking a diff header or file-op file row fires
 * onOpenFile with the correct payload.
 */

import { type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandsContext } from '../components/CommandsContext';
import { ThemeContext } from '../components/ThemeContext';
import { diffDef } from '../components/diff/diff.def';
import { diffFixtures } from '../components/diff/diff.fixtures';
import { FileOperation } from '../components/file-op/FileOperation';
import { DEFAULT_THEME } from '../core/theme';
import type { ChatCommands } from '../index';
import { makeContractCtx } from './contract';

const ctx = makeContractCtx({ width: 640 });

// ── Helpers ───────────────────────────────────────────────────────────────────

const hosts: HTMLElement[] = [];

function mountWithCommands(
  commands: () => ChatCommands,
  renderFn: () => JSX.Element
): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  host.style.width = '640px';
  document.body.appendChild(host);
  hosts.push(host);

  const dispose = render(
    () => (
      <ThemeContext.Provider value={() => DEFAULT_THEME}>
        <CommandsContext.Provider value={commands}>
          {renderFn()}
        </CommandsContext.Provider>
      </ThemeContext.Provider>
    ),
    host
  );
  return { host, dispose };
}

afterEach(() => {
  while (hosts.length > 0) {
    const h = hosts.pop();
    h?.remove();
  }
});

// ── Diff header ───────────────────────────────────────────────────────────────

const renderCtx = { viewState: { isCollapsed: () => false } };

describe('Diff header: onOpenFile', () => {
  it('fires with correct payload when clicking the header', async () => {
    const item = diffFixtures[0];
    const measured = diffDef.measure(item, ctx);
    const onOpenFile = vi.fn();

    const { dispose } = mountWithCommands(
      () => ({ onOpenFile }),
      () => (
        <diffDef.Render item={item} layout={measured} ctx={renderCtx} />
      )
    );

    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Click the header (first child of the rendered diff)
    const header = document.querySelector('[role="button"]') as HTMLElement | null;
    header?.click();

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({
      path: item.path,
      itemId: item.id,
      source: 'diff',
    });

    dispose();
  });

  it('does not throw when no onOpenFile is provided', async () => {
    const item = diffFixtures[0];
    const measured = diffDef.measure(item, ctx);

    const { dispose } = mountWithCommands(
      () => ({}),
      () => (
        <diffDef.Render item={item} layout={measured} ctx={renderCtx} />
      )
    );

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const header = document.querySelector('[role="button"]') as HTMLElement | null;
    expect(() => header?.click()).not.toThrow();

    dispose();
  });
});

// ── FileOperation single file ─────────────────────────────────────────────────

describe('FileOperation: onOpenFile', () => {
  it('fires for a single-file row click', async () => {
    const onOpenFile = vi.fn();
    const item = {
      kind: 'file-op' as const,
      id: 'fo-test-1',
      op: 'edit' as const,
      status: 'done' as const,
      ops: [{ path: 'src/utils.ts' }],
    };

    const { dispose } = mountWithCommands(
      () => ({ onOpenFile }),
      () => <FileOperation item={item} />
    );

    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const row = document.querySelector('[role="button"]') as HTMLElement | null;
    row?.click();

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'src/utils.ts',
      itemId: 'fo-test-1',
      source: 'file-op',
    });

    dispose();
  });

  it('fires for expanded multi-file row clicks', async () => {
    const onOpenFile = vi.fn();
    const item = {
      kind: 'file-op' as const,
      id: 'fo-test-2',
      op: 'read' as const,
      status: 'done' as const,
      ops: [{ path: 'a.ts' }, { path: 'b.ts' }],
    };

    // Collapsed=true means expanded (inverted semantics per model docs).
    const { dispose } = mountWithCommands(
      () => ({ onOpenFile }),
      () => <FileOperation item={item} collapsed={true} />
    );

    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // The first [role=button] is the collapse toggle; file rows are next.
    const buttons = Array.from(document.querySelectorAll('[role="button"]')) as HTMLElement[];
    // Click the file rows (indices 1 and 2; index 0 is the collapse toggle).
    buttons[1]?.click();

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile.mock.calls[0][0].path).toBe('a.ts');
    expect(onOpenFile.mock.calls[0][0].source).toBe('file-op');

    dispose();
  });
});
