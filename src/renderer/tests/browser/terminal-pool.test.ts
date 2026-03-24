/**
 * Browser-mode tests for FrontendPtyRegistry.
 *
 * Runs in real Chromium via Playwright so xterm Terminal instances are fully
 * initialised (real canvas, real ResizeObserver).  Only `@renderer/core/ipc`
 * and `@shared/events/ptyEvents` are mocked — they access window.electronAPI
 * at module load time, which does not exist outside Electron.  All other
 * dependencies (cssVars, logger, terminalHost) run normally.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { frontendPtyRegistry } from '../../core/pty/pty';
import { ensureXtermHost } from '../../core/pty/xterm-host';

vi.mock('@renderer/core/ipc', () => ({
  rpc: {
    app: { openExternal: vi.fn().mockResolvedValue(undefined) },
    pty: {
      resize: vi.fn().mockResolvedValue(undefined),
      getBuffer: vi.fn().mockResolvedValue({ success: true, data: { buffer: '' } }),
    },
  },
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    once: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMountTarget(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '800px';
  el.style.height = '400px';
  el.style.position = 'absolute';
  document.body.appendChild(el);
  return el;
}

function hasTerminalChild(el: HTMLElement): boolean {
  return el.children.length > 0;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

afterEach(async () => {
  // Wait one animation frame so xterm's internal RenderDebouncer completes any
  // pending renders before we dispose terminals.  Without this, the debouncer's
  // scheduled rAF fires after terminal.dispose() and throws from xterm's global
  // error handler, causing Vitest to report unhandled errors.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  frontendPtyRegistry.disposeAll();
  // Remove any mount-target divs left over from this test.
  document.querySelectorAll('div[data-test-mount]').forEach((el) => (el as HTMLElement).remove());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FrontendPtyRegistry.register — creates terminal', () => {
  it('creates a terminal accessible via get() after register()', async () => {
    await frontendPtyRegistry.register('reg-a');

    const pty = frontendPtyRegistry.get('reg-a');
    expect(pty).toBeDefined();
    expect(pty!.terminal).toBeDefined();
  });

  it('is idempotent — second register() for same sessionId is a no-op', async () => {
    await frontendPtyRegistry.register('idem-a');
    const first = frontendPtyRegistry.get('idem-a');

    await frontendPtyRegistry.register('idem-a');
    const second = frontendPtyRegistry.get('idem-a');

    expect(second).toBe(first);
  });

  it('creates distinct FrontendPty instances for different session IDs', async () => {
    await frontendPtyRegistry.register('distinct-a');
    await frontendPtyRegistry.register('distinct-b');

    const a = frontendPtyRegistry.get('distinct-a');
    const b = frontendPtyRegistry.get('distinct-b');
    expect(a).not.toBe(b);
    expect(a!.terminal).not.toBe(b!.terminal);
  });
});

describe('FrontendPty.mount', () => {
  it('appends ownedContainer to the mount target', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'mount-1';

    await frontendPtyRegistry.register('mount-a');
    frontendPtyRegistry.get('mount-a')!.mount(el);

    expect(hasTerminalChild(el)).toBe(true);

    el.remove();
  });

  it('resizes terminal to targetDims before appending to the DOM', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'dims-1';

    await frontendPtyRegistry.register('dims-a');
    const pty = frontendPtyRegistry.get('dims-a')!;
    const targetDims = { cols: 100, rows: 40 };
    pty.mount(el, targetDims);

    expect(pty.terminal.cols).toBe(targetDims.cols);
    expect(pty.terminal.rows).toBe(targetDims.rows);

    el.remove();
  });

  it('does not resize when terminal already has the target dims', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'dims-2';

    await frontendPtyRegistry.register('dims-b');
    const pty = frontendPtyRegistry.get('dims-b')!;
    pty.mount(el, { cols: 80, rows: 24 });

    expect(pty.terminal.cols).toBe(80);
    expect(pty.terminal.rows).toBe(24);

    frontendPtyRegistry.get('dims-b')!.unmount();

    const resizeSpy = vi.spyOn(pty.terminal, 'resize');
    pty.mount(el, { cols: 80, rows: 24 });
    expect(resizeSpy).not.toHaveBeenCalled();

    el.remove();
  });

  it('resizes on re-mount when dims have changed', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'dims-3';

    await frontendPtyRegistry.register('dims-c');
    const pty = frontendPtyRegistry.get('dims-c')!;
    pty.mount(el, { cols: 80, rows: 24 });
    pty.unmount();

    pty.mount(el, { cols: 120, rows: 40 });
    expect(pty.terminal.cols).toBe(120);
    expect(pty.terminal.rows).toBe(40);

    el.remove();
  });

  it('reparents to a new mount target on re-mount', async () => {
    const el1 = makeMountTarget();
    el1.dataset['testMount'] = 'reparent-1';
    const el2 = makeMountTarget();
    el2.dataset['testMount'] = 'reparent-2';

    await frontendPtyRegistry.register('reparent-a');
    const pty = frontendPtyRegistry.get('reparent-a')!;

    pty.mount(el1);
    expect(hasTerminalChild(el1)).toBe(true);

    pty.unmount();
    pty.mount(el2);

    expect(hasTerminalChild(el2)).toBe(true);

    el1.remove();
    el2.remove();
  });
});

describe('FrontendPty.unmount', () => {
  it('moves ownedContainer to the off-screen host on unmount', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'unmount-1';

    await frontendPtyRegistry.register('unmount-a');
    const pty = frontendPtyRegistry.get('unmount-a')!;
    pty.mount(el);
    expect(hasTerminalChild(el)).toBe(true);

    pty.unmount();

    // Mount target is now empty.
    expect(hasTerminalChild(el)).toBe(false);
    // Terminal host has the container.
    const host = ensureXtermHost();
    expect(host.children.length).toBeGreaterThan(0);

    el.remove();
  });
});

describe('FrontendPtyRegistry.unregister', () => {
  it('removes the entry so get() returns undefined afterward', async () => {
    await frontendPtyRegistry.register('unreg-a');
    expect(frontendPtyRegistry.get('unreg-a')).toBeDefined();

    frontendPtyRegistry.unregister('unreg-a');
    expect(frontendPtyRegistry.get('unreg-a')).toBeUndefined();
  });

  it('is a no-op for unknown session IDs', () => {
    expect(() => frontendPtyRegistry.unregister('unknown-session')).not.toThrow();
  });

  it('removes the container so a subsequent register() creates a new terminal', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'unreg-2';

    await frontendPtyRegistry.register('unreg-b');
    const first = frontendPtyRegistry.get('unreg-b')!.terminal;
    frontendPtyRegistry.unregister('unreg-b');

    await frontendPtyRegistry.register('unreg-b');
    const second = frontendPtyRegistry.get('unreg-b')!.terminal;
    expect(second).not.toBe(first);

    el.remove();
  });
});

describe('FrontendPtyRegistry.disposeAll', () => {
  it('clears all entries so get() returns undefined for all sessions', async () => {
    await frontendPtyRegistry.register('all-a');
    await frontendPtyRegistry.register('all-b');

    frontendPtyRegistry.disposeAll();

    expect(frontendPtyRegistry.get('all-a')).toBeUndefined();
    expect(frontendPtyRegistry.get('all-b')).toBeUndefined();
  });

  it('subsequent register() after disposeAll() creates new terminals', async () => {
    await frontendPtyRegistry.register('all-c');
    const t1 = frontendPtyRegistry.get('all-c')!.terminal;

    frontendPtyRegistry.disposeAll();
    await frontendPtyRegistry.register('all-c');
    const t2 = frontendPtyRegistry.get('all-c')!.terminal;

    expect(t2).not.toBe(t1);
  });
});
