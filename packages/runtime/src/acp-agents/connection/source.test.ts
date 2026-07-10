import type { Client } from '@agentclientprotocol/sdk';
import type { IAcpBehavior } from '@emdash/core/agents/plugins';
import { isOk, ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { acquireAsResult } from '@emdash/wire/util';
import { describe, expect, it, vi } from 'vitest';
import { FakeAcpAgent, FakeAcpProcessHost } from '../acp-test-support';
import {
  createAcpConnectionSource,
  isAcpConnectionError,
  makeAcpConnectionKey,
} from './source';

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

function sourceDeps(host: FakeAcpProcessHost, onClosed = vi.fn()) {
  return {
    host,
    spawnContext: {
      resolve: vi.fn().mockResolvedValue(ok({ cli: '/usr/local/bin/fake-agent', agentEnv: {} })),
      invalidate: vi.fn(),
    },
    logger: noopLogger,
    onClosed,
  };
}

describe('createAcpConnectionSource', () => {
  it('dedupes acquisitions by provider/workspace and refcounts release', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const source = createAcpConnectionSource(sourceDeps(host));
    const key = makeAcpConnectionKey('claude', 'ws-1');

    const first = await acquireAsResult(source, key, acquireInput(agent), isAcpConnectionError);
    const second = await acquireAsResult(source, key, acquireInput(agent), isAcpConnectionError);

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(host.allHandles).toHaveLength(1);

    await first.data.release();
    expect(host.lastHandle.kill).not.toHaveBeenCalled();
    expect(source.peek(key)).not.toBeUndefined();

    await second.data.release();
    expect(host.lastHandle.kill).toHaveBeenCalledWith('SIGTERM');
    await waitForTeardown();
    expect(source.peek(key)).toBeUndefined();
  });

  it('provisions separate workspaces independently', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const source = createAcpConnectionSource(sourceDeps(host));

    await acquireAsResult(
      source,
      makeAcpConnectionKey('claude', 'ws-1'),
      acquireInput(agent, 'ws-1'),
      isAcpConnectionError
    );
    await acquireAsResult(
      source,
      makeAcpConnectionKey('claude', 'ws-2'),
      acquireInput(agent, 'ws-2'),
      isAcpConnectionError
    );

    expect(host.allHandles).toHaveLength(2);
  });

  it('forwards process close and invalidates closed entries', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const onClosed = vi.fn();
    const source = createAcpConnectionSource(sourceDeps(host, onClosed));
    const key = makeAcpConnectionKey('claude', 'ws-1');

    await acquireAsResult(source, key, acquireInput(agent), isAcpConnectionError);
    host.lastHandle.emitExit(7);

    expect(onClosed).toHaveBeenCalledWith(key, 7);
    await source.invalidate(key);
    await waitForTeardown();
    expect(source.peek(key)).toBeUndefined();
  });

  it('disposes all active pooled processes', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const source = createAcpConnectionSource(sourceDeps(host));
    const key = makeAcpConnectionKey('claude', 'ws-1');

    const acquired = await acquireAsResult(source, key, acquireInput(agent), isAcpConnectionError);
    expect(isOk(acquired)).toBe(true);
    await source.dispose();

    expect(host.lastHandle.kill).toHaveBeenCalledWith('SIGTERM');
    expect(source.peek(key)).toBeUndefined();
  });
});
