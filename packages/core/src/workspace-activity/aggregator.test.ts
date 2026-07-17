import { createController, createLiveModelHost } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it } from 'vitest';
import { ActivityAggregator, providerFromClient, type ActivityProvider } from './aggregator';
import { activityProviderContract } from './contract';
import type { SessionInfo } from './schema';

describe('ActivityAggregator', () => {
  it('groups provider sessions by workspace path', () => {
    const acp = fakeProvider('acp', [
      session('acp', 'a', '/workspace/a'),
      session('acp', 'b', '/workspace/b'),
    ]);
    const pty = fakeProvider('pty', [session('pty', 'c', '/workspace/a')]);
    const aggregator = new ActivityAggregator([acp, pty]);
    try {
      expect(aggregator.sessionsFor('/workspace/a').map((entry) => entry.sessionId)).toEqual([
        'a',
        'c',
      ]);
      expect(
        aggregator.host.get({ path: '/workspace/a' })?.states.activity.snapshot().data.sessions
      ).toEqual(aggregator.sessionsFor('/workspace/a'));
      expect(aggregator.sessionsFor('/workspace/b').map((entry) => entry.sessionId)).toEqual(['b']);
    } finally {
      aggregator.dispose();
    }
  });

  it('clears a runtime when the provider is removed and repopulates on reattach', () => {
    const provider = fakeProvider('acp', [session('acp', 'a', '/workspace/a')]);
    const aggregator = new ActivityAggregator();
    try {
      const detach = aggregator.addProvider(provider);
      expect(aggregator.sessionsFor('/workspace/a')).toHaveLength(1);

      detach();
      expect(aggregator.sessionsFor('/workspace/a')).toEqual([]);
      expect(
        aggregator.host.get({ path: '/workspace/a' })?.states.activity.snapshot().data.sessions
      ).toEqual([]);

      aggregator.addProvider(provider);
      expect(aggregator.sessionsFor('/workspace/a')).toHaveLength(1);
    } finally {
      aggregator.dispose();
    }
  });

  it('can consume a runtime activity model through providerFromClient', async () => {
    const host = createLiveModelHost(activityProviderContract.activity);
    const cell = host.create({}, { sessions: [] });
    const controller = createController(activityProviderContract, { activity: host });
    const wire = createTestWire(activityProviderContract, controller, { validate: 'full' });
    const contractClient = wire.client;
    const aggregator = new ActivityAggregator([
      providerFromClient('acp', { activity: contractClient.activity }),
    ]);
    try {
      cell.states.sessions.produce((draft) => {
        draft.push(session('acp', 'a', '/workspace/a'));
      });

      await expect
        .poll(() => aggregator.sessionsFor('/workspace/a').map((entry) => entry.sessionId))
        .toEqual(['a']);
      expect(
        aggregator.host.get({ path: '/workspace/a' })?.states.activity.snapshot().data.sessions
      ).toEqual([session('acp', 'a', '/workspace/a')]);
    } finally {
      aggregator.dispose();
      wire.dispose();
      host.dispose();
    }
  });
});

function fakeProvider(runtime: string, initial: SessionInfo[]): ActivityProvider {
  return {
    runtime,
    attach(onSessions) {
      onSessions(initial);
      return () => onSessions([]);
    },
  };
}

function session(runtime: string, sessionId: string, workspacePath: string): SessionInfo {
  return {
    runtime,
    sessionId,
    workspacePath,
    status: 'running',
    startedAt: 1,
  };
}
