import { isErr, isOk } from '@emdash/shared';
import { vi, describe, it, expect } from 'vitest';
import type { IAcpBehavior } from '../agents/plugins/capabilities/acp';
import { createAcpAgentConnection } from './acp-agent-connection';
import { FakeAcpAgent, FakeAcpProcessHost } from './acp-test-support';

function makeBehavior(agent: FakeAcpAgent): IAcpBehavior {
  return {
    buildSpawn: vi.fn().mockReturnValue({ command: '/fake/agent', args: ['--stdio'], env: {} }),
    connect: agent.behavior.connect,
  };
}

function makeCtx(agent?: FakeAcpAgent) {
  const fakeAgent = agent ?? new FakeAcpAgent();
  const host = new FakeAcpProcessHost();
  const behavior = makeBehavior(fakeAgent);
  return { host, fakeAgent, behavior };
}

const connArgs = (onClosed = vi.fn()) => ({
  providerId: 'test-provider',
  cwd: '/tmp/workspace',
  buildClient: vi.fn(),
  onClosed,
});

describe('createAcpAgentConnection()', () => {
  it('resolves spawn context, calls buildSpawn, and returns ok', async () => {
    const { host, behavior } = makeCtx();
    const result = await createAcpAgentConnection({ host, behavior }, connArgs());
    expect(isOk(result)).toBe(true);
    expect(host.resolveSpawnContext).toHaveBeenCalledWith('test-provider');
    expect(behavior.buildSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp/workspace', cli: '/usr/local/bin/fake-agent' })
    );
  });

  it('returns err(spawn_failed) when spawn throws', async () => {
    const { host, behavior } = makeCtx();
    host.resolveSpawnContext = vi.fn().mockRejectedValue(new Error('spawn-error'));
    const result = await createAcpAgentConnection({ host, behavior }, connArgs());
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('spawn_failed');
    expect(result.error.cause?.message).toBe('spawn-error');
  });

  it('calls onClosed when the process exits', async () => {
    const { host, behavior } = makeCtx();
    const onClosed = vi.fn();
    await createAcpAgentConnection({ host, behavior }, connArgs(onClosed));
    host.lastHandle.emitExit(0);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('initialized resolves ok with supportsLoadSession derived from agent capabilities', async () => {
    for (const loadSession of [true, false]) {
      const agent = new FakeAcpAgent();
      agent.initialize = vi.fn().mockResolvedValue({
        protocolVersion: 1,
        agentCapabilities: { loadSession },
      });
      const { host, behavior } = makeCtx(agent);
      const result = await createAcpAgentConnection({ host, behavior }, connArgs());
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      const caps = await result.data.initialized;
      expect(isOk(caps)).toBe(true);
      if (!isOk(caps)) return;
      expect(caps.data.supportsLoadSession).toBe(loadSession);
    }
  });

  it('initialized resolves err and calls onClosed when initialize fails', async () => {
    const agent = new FakeAcpAgent();
    agent.initialize = vi.fn().mockRejectedValue(new Error('init-failed'));
    const { host, behavior } = makeCtx(agent);
    const onClosed = vi.fn();
    const result = await createAcpAgentConnection({ host, behavior }, connArgs(onClosed));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const caps = await result.data.initialized;
    expect(isErr(caps)).toBe(true);
    if (!isErr(caps)) return;
    expect(caps.error.type).toBe('initialize_failed');
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('advertises terminal capability based on host.spawnTerminal presence', async () => {
    const withTerminal = new FakeAcpProcessHost();
    const withoutTerminal = new FakeAcpProcessHost();
    (withoutTerminal as { spawnTerminal?: unknown }).spawnTerminal = undefined;

    for (const [host, expected] of [
      [withTerminal, true],
      [withoutTerminal, false],
    ] as const) {
      const agent = new FakeAcpAgent();
      const behavior = makeBehavior(agent);
      await createAcpAgentConnection({ host, behavior }, connArgs());
      const initCall = agent.initialize.mock.calls[0]?.[0];
      expect(initCall?.clientCapabilities?.terminal).toBe(expected);
    }
  });

  it('normalize applies behavior.enrich when present', async () => {
    const agent = new FakeAcpAgent();
    const host = new FakeAcpProcessHost();
    const enrichSpy = vi.fn().mockImplementation((u) => ({ ...u, enriched: true }));
    const behavior: IAcpBehavior = {
      buildSpawn: vi.fn().mockReturnValue({ command: '/fake/agent', args: [], env: {} }),
      connect: agent.behavior.connect,
      enrich: enrichSpy,
    };
    const result = await createAcpAgentConnection({ host, behavior }, connArgs());
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const raw = { sessionUpdate: 'message_delta', delta: { type: 'text', text: 'hi' } } as never;
    const out = result.data.normalize(raw);
    expect(enrichSpy).toHaveBeenCalledTimes(1);
    expect((out as { enriched?: boolean }).enriched).toBe(true);
  });
});
