/**
 * Browser-mode tests for TerminalPool.
 *
 * Runs in real Chromium via Playwright so xterm Terminal instances are fully
 * initialised (real canvas, real ResizeObserver).  Only `@renderer/core/ipc`
 * is mocked — it accesses window.electronAPI at module load time, which does
 * not exist outside Electron.  All other dependencies (cssVars, logger,
 * terminalHost) run normally.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_POOL_SIZE, terminalPool } from '../../core/terminals/terminal-pool';
import { ensureTerminalHost } from '../../terminal/terminalHost';

vi.mock('@renderer/core/ipc', () => ({
  rpc: {
    app: { openExternal: vi.fn().mockResolvedValue(undefined) },
    pty: { resize: vi.fn().mockResolvedValue(undefined) },
  },
  events: {
    emit: vi.fn(),
    on: vi.fn(() => ({ dispose: vi.fn() })),
    once: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

// WebGL2 is not available in Chrome Headless Shell.  We are testing pool
// bookkeeping and DOM management, not GPU rendering, so stub the addon.
// This also prevents xterm's global error handler from firing an unhandled
// exception that would cause Vitest to exit with code 1.
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
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
  terminalPool.disposeAll();
  // Remove any mount-target divs left over from this test.
  document.querySelectorAll('div[data-test-mount]').forEach((el) => (el as HTMLElement).remove());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TerminalPool.lease — cold path', () => {
  it('appends the terminal container to the mount target on first lease', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '1';

    const { terminal } = terminalPool.lease('cold-a', el);

    expect(terminal).toBeDefined();
    // The pool-owned ownedContainer should be a child of el.
    expect(hasTerminalChild(el)).toBe(true);
  });

  it('creates distinct terminals for different session IDs', () => {
    const el1 = makeMountTarget();
    el1.dataset['testMount'] = '2';
    const el2 = makeMountTarget();
    el2.dataset['testMount'] = '3';

    const { terminal: t1 } = terminalPool.lease('distinct-a', el1);
    terminalPool.release('distinct-a');
    const { terminal: t2 } = terminalPool.lease('distinct-b', el2);

    expect(t1).not.toBe(t2);
  });
});

describe('TerminalPool.lease — re-lease path', () => {
  it('reparents the same terminal to a new mount target on re-lease', () => {
    const el1 = makeMountTarget();
    el1.dataset['testMount'] = '4';
    const el2 = makeMountTarget();
    el2.dataset['testMount'] = '5';

    const { terminal: first } = terminalPool.lease('relase-a', el1);
    expect(hasTerminalChild(el1)).toBe(true);

    // Simulate tab switch: release then re-lease to a different mount target.
    terminalPool.release('relase-a');
    const { terminal: second } = terminalPool.lease('relase-a', el2);

    // Same terminal object is returned.
    expect(second).toBe(first);
    // Container moved to new mount target.
    expect(hasTerminalChild(el2)).toBe(true);

    el1.remove();
    el2.remove();
  });

  it('returns the terminal already at the correct mount target on re-lease', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '6';

    terminalPool.lease('same-target', el);
    const { terminal } = terminalPool.lease('same-target', el);

    expect(terminal).toBeDefined();
    expect(hasTerminalChild(el)).toBe(true);

    el.remove();
  });
});

describe('TerminalPool.lease — targetDims pre-resize', () => {
  it('resizes the terminal to targetDims before appending to the DOM', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '7';

    const targetDims = { cols: 100, rows: 40 };
    const { terminal } = terminalPool.lease('dims-a', el, { targetDims });

    // The resize happens synchronously before appendChild in lease().
    expect(terminal.cols).toBe(targetDims.cols);
    expect(terminal.rows).toBe(targetDims.rows);

    el.remove();
  });

  it('does not call resize when terminal already has the target dims', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '8';

    // First lease sets initial dims.
    const { terminal } = terminalPool.lease('dims-b', el, {
      targetDims: { cols: 80, rows: 24 },
    });
    expect(terminal.cols).toBe(80);
    expect(terminal.rows).toBe(24);

    terminalPool.release('dims-b');

    // Re-lease with the same dims should be a no-op for resize.
    const resizeSpy = vi.spyOn(terminal, 'resize');
    terminalPool.lease('dims-b', el, { targetDims: { cols: 80, rows: 24 } });
    expect(resizeSpy).not.toHaveBeenCalled();

    el.remove();
  });

  it('resizes on re-lease when dims have changed', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '9';

    const { terminal } = terminalPool.lease('dims-c', el, {
      targetDims: { cols: 80, rows: 24 },
    });
    terminalPool.release('dims-c');

    // Re-lease with different dims — should resize.
    terminalPool.lease('dims-c', el, { targetDims: { cols: 120, rows: 40 } });
    expect(terminal.cols).toBe(120);
    expect(terminal.rows).toBe(40);

    el.remove();
  });
});

describe('TerminalPool.release', () => {
  it('moves the terminal container to the off-screen host on release', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '10';

    terminalPool.lease('rel-a', el);
    expect(hasTerminalChild(el)).toBe(true);

    terminalPool.release('rel-a');

    // Mount target is now empty.
    expect(hasTerminalChild(el)).toBe(false);
    // Terminal host has the container.
    const host = ensureTerminalHost();
    expect(host.children.length).toBeGreaterThan(0);

    el.remove();
  });

  it('is a no-op for unknown session IDs', () => {
    expect(() => terminalPool.release('unknown-session')).not.toThrow();
  });
});

describe('TerminalPool.dispose', () => {
  it('removes the entry so a subsequent lease creates a new terminal', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '11';

    const { terminal: first } = terminalPool.lease('disp-a', el);
    terminalPool.dispose('disp-a');

    // Re-lease after dispose → new terminal instance.
    const { terminal: second } = terminalPool.lease('disp-a', el);
    expect(second).not.toBe(first);

    el.remove();
  });

  it('is a no-op for unknown session IDs', () => {
    expect(() => terminalPool.dispose('unknown-session')).not.toThrow();
  });
});

describe('TerminalPool.disposeAll', () => {
  it('clears all entries so subsequent leases start fresh', () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = '12';

    const { terminal: t1 } = terminalPool.lease('all-a', el);
    const { terminal: t2 } = terminalPool.lease('all-b', el);
    terminalPool.disposeAll();

    // New leases after disposeAll should return new terminals.
    const { terminal: t1b } = terminalPool.lease('all-a', el);
    const { terminal: t2b } = terminalPool.lease('all-b', el);

    expect(t1b).not.toBe(t1);
    expect(t2b).not.toBe(t2);

    el.remove();
  });
});

describe('TerminalPool — LRU eviction at MAX_POOL_SIZE', () => {
  it(
    'evicts the LRU entry and succeeds when leasing beyond capacity',
    { timeout: 30_000 },
    async () => {
      const mounts: HTMLDivElement[] = [];

      // Fill the pool to max capacity.
      for (let i = 0; i < MAX_POOL_SIZE; i++) {
        const el = makeMountTarget();
        el.dataset['testMount'] = `lru-${i}`;
        mounts.push(el);
        terminalPool.lease(`lru-session-${i}`, el);
        // Small yield so the browser doesn't hang on rapid terminal creation.
        await new Promise((r) => setTimeout(r, 5));
      }

      // One more lease — should trigger LRU eviction without throwing.
      const extra = makeMountTarget();
      extra.dataset['testMount'] = 'lru-extra';
      mounts.push(extra);

      expect(() => terminalPool.lease('lru-session-extra', extra)).not.toThrow();
      expect(hasTerminalChild(extra)).toBe(true);

      // Cleanup
      mounts.forEach((el) => el.remove());
    }
  );
});

describe('TerminalPool — spare pool management', () => {
  it('creates spares asynchronously after a new lease', async () => {
    const el = makeMountTarget();
    el.dataset['testMount'] = 'spare-1';

    // After the first lease, ensureSpares schedules a setTimeout(0).
    terminalPool.lease('spare-session-a', el);

    // Wait for the spare creation timeout to fire.
    await new Promise((r) => setTimeout(r, 50));

    // We can't inspect the internal spares array directly, but we CAN verify
    // that a second (different) lease still succeeds and produces a terminal,
    // regardless of whether it hit a spare or the cold path.
    const el2 = makeMountTarget();
    el2.dataset['testMount'] = 'spare-2';
    const { terminal } = terminalPool.lease('spare-session-b', el2);
    expect(terminal).toBeDefined();
    expect(hasTerminalChild(el2)).toBe(true);

    el.remove();
    el2.remove();
  });

  it('trims excess spares when the active count drops after dispose', async () => {
    const mounts: HTMLDivElement[] = [];

    // Create 4 active sessions.
    for (let i = 0; i < 4; i++) {
      const el = makeMountTarget();
      el.dataset['testMount'] = `trim-${i}`;
      mounts.push(el);
      terminalPool.lease(`trim-session-${i}`, el);
    }

    // Wait for spares to be created.
    await new Promise((r) => setTimeout(r, 100));

    // Dispose all but one.  targetSpareCount = min(1, MAX-1) = 1.
    // Excess spares should be trimmed.
    for (let i = 1; i < 4; i++) {
      terminalPool.dispose(`trim-session-${i}`);
    }

    // Pool state should be internally consistent — verify by leasing more
    // sessions without error.
    for (let i = 4; i < 8; i++) {
      const el = makeMountTarget();
      el.dataset['testMount'] = `trim-extra-${i}`;
      mounts.push(el);
      expect(() => terminalPool.lease(`trim-session-${i}`, el)).not.toThrow();
    }

    mounts.forEach((el) => el.remove());
  });
});
