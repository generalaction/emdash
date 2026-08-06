import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualClock } from '@emdash/shared/testing';
import { remote, snapshot } from '@emdash/wire';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { workspaceRegistryContract } from '@runtimes/workspace-registry/api';
import {
  workspaceRegistryStore,
  type WorkspaceRegistryDb,
} from '@runtimes/workspace-registry/node/persistence/store';
import { WorkspaceRegistryRuntime } from '@runtimes/workspace-registry/node/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceRegistryController } from './controller';

// Contract-seam tests for the activation lifecycle (ADR 0005): activate returns at the
// session-gating point (prepare); setup and run continue in the background and are
// observable only through the records overlay; script failures are notices, never verb
// errors; deactivate owns kill-sessions + time-boxed non-fatal teardown; activation is
// ephemeral — a daemon restart leaves only lastActivatedAt.

async function eventually(assertion: () => Promise<void>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe('workspace registry activation lifecycle', () => {
  let root: string;
  let handle: TempStoreHandle<WorkspaceRegistryDb>;
  let clock: ManualClock;
  let runtime: WorkspaceRegistryRuntime;
  let wire: TestWire<typeof workspaceRegistryContract>;
  let killedPaths: string[];

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-activation-')));
    handle = await workspaceRegistryStore.openTemp();
    clock = new ManualClock(10_000);
    killedPaths = [];
    runtime = new WorkspaceRegistryRuntime({
      handle,
      clock,
      killSessions: async (workspacePath) => {
        killedPaths.push(workspacePath);
      },
      activation: { teardownTimeoutMs: 500 },
    });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));
  });

  afterEach(async () => {
    wire.dispose();
    runtime.dispose();
    handle.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function listRecords() {
    const records = remote(workspaceRegistryContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      return snapshot(model.states.list).value ?? {};
    } finally {
      await records.dispose();
    }
  }

  async function makeWorkspace(
    name: string,
    scripts: Partial<Record<'prepare' | 'setup' | 'run' | 'teardown', string>>
  ): Promise<string> {
    const workspacePath = path.join(root, name);
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, '.emdash.json'), JSON.stringify({ scripts }));
    const created = await wire.client.createWorkspace({ id: `ws-${name}`, path: workspacePath });
    expect(created.success).toBe(true);
    return workspacePath;
  }

  it('activate returns after prepare; setup and run progress through the overlay', async () => {
    const workspacePath = await makeWorkspace('staged', {
      prepare: 'echo prepared > prepare-marker',
      setup: 'until [ -f gate ]; do sleep 0.05; done; echo done > setup-marker',
      run: 'echo ran > run-marker',
    });

    const activated = await wire.client.activateWorkspace({ id: 'ws-staged' });
    if (!activated.success) throw new Error('activate failed');

    // The verb returned at the session-gating point: prepare is done, setup is not.
    await expect(fs.readFile(path.join(workspacePath, 'prepare-marker'), 'utf8')).resolves.toBe(
      'prepared\n'
    );
    expect(activated.data.lastActivatedAt).toBe(10_000);
    expect(activated.data.runtime?.activation).toMatchObject({
      phase: 'active',
      activatedAt: 10_000,
      scripts: { prepare: 'succeeded' },
    });
    expect(['pending', 'running']).toContain(activated.data.runtime?.activation?.scripts.setup);
    await expect(fs.stat(path.join(workspacePath, 'setup-marker'))).rejects.toThrow();

    // Releasing the gate lets setup finish; run waits on setup success, then exits.
    await fs.writeFile(path.join(workspacePath, 'gate'), '');
    await eventually(async () => {
      const records = await listRecords();
      expect(records['ws-staged']?.runtime?.activation?.scripts).toEqual({
        prepare: 'succeeded',
        setup: 'succeeded',
        run: 'exited',
      });
    });
    await expect(fs.readFile(path.join(workspacePath, 'run-marker'), 'utf8')).resolves.toBe(
      'ran\n'
    );
  });

  it('a failing prepare script yields a notice, never a verb error', async () => {
    await makeWorkspace('broken', { prepare: 'echo broken >&2; exit 7' });

    const activated = await wire.client.activateWorkspace({ id: 'ws-broken' });
    if (!activated.success) throw new Error('activate failed');

    expect(activated.data.runtime?.activation).toMatchObject({
      phase: 'active',
      scripts: { prepare: 'failed' },
    });
    expect(activated.data.runtime?.notices).toEqual([
      expect.objectContaining({ kind: 'script-failed', script: 'prepare' }),
    ]);
  });

  it('a failed setup keeps run from starting', async () => {
    const workspacePath = await makeWorkspace('half', {
      setup: 'exit 1',
      run: 'echo ran > run-marker',
    });

    const activated = await wire.client.activateWorkspace({ id: 'ws-half' });
    expect(activated.success).toBe(true);

    await eventually(async () => {
      const records = await listRecords();
      expect(records['ws-half']?.runtime?.activation?.scripts).toEqual({
        prepare: 'skipped',
        setup: 'failed',
        run: 'skipped',
      });
    });
    await expect(fs.stat(path.join(workspacePath, 'run-marker'))).rejects.toThrow();
  });

  it('deactivate kills sessions, runs teardown exactly once, and clears activation', async () => {
    const workspacePath = await makeWorkspace('lifecycle', {
      teardown: 'echo teardown >> teardown-log',
    });

    const activated = await wire.client.activateWorkspace({ id: 'ws-lifecycle' });
    expect(activated.success).toBe(true);

    const deactivated = await wire.client.deactivateWorkspace({ id: 'ws-lifecycle' });
    expect(deactivated).toEqual({ success: true, data: undefined });
    expect(killedPaths).toEqual([workspacePath]);
    await expect(fs.readFile(path.join(workspacePath, 'teardown-log'), 'utf8')).resolves.toBe(
      'teardown\n'
    );
    const records = await listRecords();
    expect(records['ws-lifecycle']?.runtime?.activation ?? null).toBeNull();

    // Idempotent on inactive workspaces: sessions are swept again, teardown is not re-run.
    const again = await wire.client.deactivateWorkspace({ id: 'ws-lifecycle' });
    expect(again.success).toBe(true);
    await expect(fs.readFile(path.join(workspacePath, 'teardown-log'), 'utf8')).resolves.toBe(
      'teardown\n'
    );
  });

  it('a hanging teardown is cut off at the time-box and deactivation still succeeds', async () => {
    await makeWorkspace('hanging', { teardown: 'sleep 30' });
    const activated = await wire.client.activateWorkspace({ id: 'ws-hanging' });
    expect(activated.success).toBe(true);

    const startedAt = Date.now();
    const deactivated = await wire.client.deactivateWorkspace({ id: 'ws-hanging' });
    expect(deactivated.success).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);

    const records = await listRecords();
    expect(records['ws-hanging']?.runtime?.notices).toEqual([
      expect.objectContaining({ kind: 'script-failed', script: 'teardown' }),
    ]);
    expect(records['ws-hanging']?.runtime?.activation ?? null).toBeNull();
  });

  it('script outcomes are durable: a failed setup survives a restart and a later success overwrites it', async () => {
    const workspacePath = await makeWorkspace('outcomes', {
      prepare: 'echo prepared',
      setup: '[ -f fixed ] || { echo setup broke >&2; exit 3; }',
      run: 'echo ran',
    });

    expect((await wire.client.activateWorkspace({ id: 'ws-outcomes' })).success).toBe(true);
    await eventually(async () => {
      const records = await listRecords();
      expect(records['ws-outcomes']?.scriptOutcomes).toEqual({
        prepare: { outcome: 'succeeded', at: 10_000 },
        setup: { outcome: 'failed', at: 10_000, message: expect.any(String) },
        // Run never started (setup gates it), so no outcome exists to record.
        run: null,
      });
    });

    // Simulated daemon restart: the overlay dies, the durable outcomes do not.
    wire.dispose();
    runtime.dispose();
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));
    expect((await listRecords())['ws-outcomes']).toMatchObject({
      runtime: null,
      scriptOutcomes: { setup: { outcome: 'failed', at: 10_000 } },
    });

    // A later success overwrites the failure in place — no history list.
    await fs.writeFile(path.join(workspacePath, 'fixed'), '');
    await clock.advanceBy(7_000);
    expect((await wire.client.activateWorkspace({ id: 'ws-outcomes' })).success).toBe(true);
    await eventually(async () => {
      const records = await listRecords();
      expect(records['ws-outcomes']?.scriptOutcomes).toEqual({
        prepare: { outcome: 'succeeded', at: 17_000 },
        setup: { outcome: 'succeeded', at: 17_000 },
        run: { outcome: 'succeeded', at: 17_000 },
      });
    });
  });

  it('a daemon restart leaves no activation state and preserves lastActivatedAt', async () => {
    await makeWorkspace('restarted', {});
    const activated = await wire.client.activateWorkspace({ id: 'ws-restarted' });
    expect(activated.success).toBe(true);

    wire.dispose();
    runtime.dispose();
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));

    const records = await listRecords();
    expect(records['ws-restarted']).toMatchObject({
      lastActivatedAt: 10_000,
      runtime: null,
    });
  });

  it('concurrent activate and deactivate on one workspace serialize via the claim', async () => {
    const workspacePath = await makeWorkspace('contended', {
      prepare: 'sleep 0.3; echo prepare >> order-log',
      teardown: 'echo teardown >> order-log',
    });

    const activating = wire.client.activateWorkspace({ id: 'ws-contended' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const deactivating = wire.client.deactivateWorkspace({ id: 'ws-contended' });

    const [activated, deactivated] = await Promise.all([activating, deactivating]);
    expect(activated.success).toBe(true);
    expect(deactivated.success).toBe(true);
    await expect(fs.readFile(path.join(workspacePath, 'order-log'), 'utf8')).resolves.toBe(
      'prepare\nteardown\n'
    );
    const records = await listRecords();
    expect(records['ws-contended']?.runtime?.activation ?? null).toBeNull();
  });

  it('activate errors on unknown ids and missing workspaces; deactivate errors on unknown ids', async () => {
    expect(await wire.client.activateWorkspace({ id: 'ws-nope' })).toEqual({
      success: false,
      error: { type: 'workspace-not-found', workspaceId: 'ws-nope' },
    });
    expect(await wire.client.deactivateWorkspace({ id: 'ws-nope' })).toEqual({
      success: false,
      error: { type: 'workspace-not-found', workspaceId: 'ws-nope' },
    });

    const workspacePath = await makeWorkspace('gone', {});
    await fs.rm(workspacePath, { recursive: true, force: true });
    const refreshed = await wire.client.refresh({ id: 'ws-gone' });
    expect(refreshed.success).toBe(true);
    expect(await wire.client.activateWorkspace({ id: 'ws-gone' })).toEqual({
      success: false,
      error: { type: 'workspace-missing', workspaceId: 'ws-gone' },
    });
  });
});
