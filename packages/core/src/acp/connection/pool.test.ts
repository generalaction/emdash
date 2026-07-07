import type { Client } from '@agentclientprotocol/sdk';
import { isOk } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { IAcpBehavior } from '../../agents/plugins/capabilities/acp';
import { FakeAcpAgent, FakeAcpProcessHost } from '../acp-test-support';
import { ConnectionPool } from './pool';

function makeBehavior(agent: FakeAcpAgent): IAcpBehavior {
  return {
    buildSpawn: vi.fn().mockReturnValue({ command: '/fake/agent', args: [], env: {} }),
    connect: agent.behavior.connect,
  };
}

function acquireInput(agent: FakeAcpAgent, workspaceId = 'ws-1') {
  return {
    providerId: 'claude',
    workspaceId,
    cwd: '/tmp/workspace',
    behavior: makeBehavior(agent),
    buildClient: vi.fn(() => ({}) as Client),
  };
}

function waitForTeardown(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ConnectionPool', () => {
  it('dedupes acquisitions by provider/workspace and refcounts release', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const pool = new ConnectionPool({ host, logger: noopLogger, onClosed: vi.fn() });

    const first = await pool.acquire(acquireInput(agent));
    const second = await pool.acquire(acquireInput(agent));

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    expect(host.allHandles).toHaveLength(1);

    pool.release('claude:ws-1');
    expect(host.lastHandle.kill).not.toHaveBeenCalled();
    expect(pool.get('claude:ws-1')).not.toBeNull();

    pool.release('claude:ws-1');
    expect(host.lastHandle.kill).toHaveBeenCalledWith('SIGTERM');
    await waitForTeardown();
    expect(pool.get('claude:ws-1')).toBeNull();
  });

  it('provisions separate workspaces independently', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const pool = new ConnectionPool({ host, logger: noopLogger, onClosed: vi.fn() });

    await pool.acquire(acquireInput(agent, 'ws-1'));
    await pool.acquire(acquireInput(agent, 'ws-2'));

    expect(host.allHandles).toHaveLength(2);
  });

  it('forwards process close and forgets closed entries', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const onClosed = vi.fn();
    const pool = new ConnectionPool({ host, logger: noopLogger, onClosed });

    await pool.acquire(acquireInput(agent));
    host.lastHandle.emitExit(7);

    expect(onClosed).toHaveBeenCalledWith('claude:ws-1', 7);
    pool.forgetClosed('claude:ws-1');
    await waitForTeardown();
    expect(pool.get('claude:ws-1')).toBeNull();
  });
});
