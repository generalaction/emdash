import { describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { LocalConversationProvider } from './local-conversation';
import { SshConversationProvider } from './ssh-conversation';

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: {},
}));

vi.mock('@main/core/agent-hooks/classifier-wiring', () => ({
  wireAgentClassifier: vi.fn(),
}));

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustLocal: vi.fn(),
    maybeAutoTrustSsh: vi.fn(),
  },
}));

vi.mock('@main/core/agent-hooks/hook-config', () => ({
  HookConfigWriter: class {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: vi.fn(),
  },
}));

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(),
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    getItem: vi.fn(),
  },
}));

type RespawnState = {
  respawnCounts: Map<string, number>;
};

function localProvider() {
  return new LocalConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    ctx: {} as never,
  });
}

function sshProvider() {
  return new SshConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    ctx: {} as never,
    proxy: {} as never,
  });
}

describe('conversation provider respawn state', () => {
  it('clears local respawn counts when explicitly stopping a session', async () => {
    const provider = localProvider();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).respawnCounts.set(sessionId, 3);

    await provider.stopSession('conversation-1');

    expect((provider as unknown as RespawnState).respawnCounts.has(sessionId)).toBe(false);
  });

  it('clears SSH respawn counts when explicitly stopping a session', async () => {
    const provider = sshProvider();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).respawnCounts.set(sessionId, 3);

    await provider.stopSession('conversation-1');

    expect((provider as unknown as RespawnState).respawnCounts.has(sessionId)).toBe(false);
  });
});
