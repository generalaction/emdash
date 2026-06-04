import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AcpSessionEvent } from '@shared/acp';
import type * as AgentProviderRegistry from '@shared/agent-provider-registry';
import { acpSessionEventChannel } from '@shared/events/acpEvents';
import type { ResolvedShellProfile } from '../terminal-shell/types';
import { AcpSessionService } from './acp-session-service';

const providerConfig = vi.hoisted(() => ({
  acpCommand: [] as string[],
}));

const emitted = vi.hoisted(() => [] as AcpSessionEvent[]);

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(async () => providerConfig),
  },
}));

vi.mock('@shared/agent-provider-registry', async (importOriginal) => {
  const original = await importOriginal<typeof AgentProviderRegistry>();
  return {
    ...original,
    getProvider: (id: string) => ({
      ...original.getProvider(id as never),
      supportsAcp: true,
    }),
  };
});

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ config: '{}' }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: (channel: { name: string }, event: unknown) => {
      if (channel.name === acpSessionEventChannel.name) emitted.push(event as AcpSessionEvent);
    },
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

function conversation(autoApprove = false) {
  return {
    id: `conversation-${Math.random().toString(16).slice(2)}`,
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex' as const,
    title: 'ACP',
    runtime: 'acp' as const,
    autoApprove,
    lastInteractedAt: null,
    isInitialConversation: false,
  };
}

function resumableConversation() {
  return {
    ...conversation(),
    resume: true,
    providerSessionId: 'existing-session',
  };
}

function shellProfile(): ResolvedShellProfile {
  return {
    id: 'sh',
    resolvedShellId: 'sh',
    resolvedFromSystem: false,
    executable: '/bin/sh',
    available: true,
    family: 'posix',
    interactiveArgs: [],
    commandArgs: [],
  };
}

async function writeFakeAgent(script: string): Promise<string> {
  const dir = path.join(
    tmpdir(),
    `emdash-acp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'fake-agent.mjs');
  await writeFile(file, script);
  return file;
}

const BASIC_FAKE_AGENT = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'fake-agent' }
    }});
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'fake-session' } });
  } else if (msg.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'fake-session',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } }
    }});
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
  }
});
`;

const PERMISSION_FAKE_AGENT = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'fake-session' } });
  } else if (msg.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: {
      sessionId: 'fake-session',
      toolCall: { toolCallId: 'tool-1', title: 'Run command', kind: 'execute' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
      ]
    }});
  } else if (msg.id === 99) {
    send({ jsonrpc: '2.0', id: 2, result: { stopReason: 'cancelled' } });
  } else if (msg.method === 'session/cancel') {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
  }
});
`;

const RESUME_FAKE_AGENT = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { resume: {} } }
    }});
  } else if (msg.method === 'session/resume') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  } else if (msg.method === 'session/new') {
    process.stderr.write('unexpected session/new');
  }
});
`;

describe('AcpSessionService', () => {
  it('starts a real stdio ACP process and emits streamed prompt updates', async () => {
    emitted.length = 0;
    const script = await writeFakeAgent(BASIC_FAKE_AGENT);
    providerConfig.acpCommand = [process.execPath, script];
    const service = new AcpSessionService();
    const conv = conversation();

    await service.startLocalSession({
      conversation: conv,
      cwd: tmpdir(),
      initialPrompt: 'hello',
      shellProfile: shellProfile(),
    });

    expect(emitted.map((event) => event.type)).toContain('session');
    expect(
      emitted.some(
        (event) =>
          event.type === 'update' &&
          event.update.sessionUpdate === 'agent_message_chunk' &&
          (event.update.content as { text?: string }).text === 'hello'
      )
    ).toBe(true);
    service.stop(conv.id);
  });

  it('cancels pending permission requests when a turn is cancelled', async () => {
    emitted.length = 0;
    const script = await writeFakeAgent(PERMISSION_FAKE_AGENT);
    providerConfig.acpCommand = [process.execPath, script];
    const service = new AcpSessionService();
    const conv = conversation();
    await service.startLocalSession({
      conversation: conv,
      cwd: tmpdir(),
      shellProfile: shellProfile(),
    });

    void service.sendPrompt(conv.id, 'needs permission').catch(() => undefined);
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.type === 'permission_request')).toBe(true);
    });
    await service.cancel(conv.id);

    expect(
      emitted.some(
        (event) =>
          event.type === 'permission_resolved' &&
          event.requestId === '99' &&
          event.outcome === 'cancelled'
      )
    ).toBe(true);
    service.stop(conv.id);
  });

  it('fails promptly when the ACP command is missing', async () => {
    emitted.length = 0;
    providerConfig.acpCommand = ['definitely-missing-emdash-acp-agent'];
    const service = new AcpSessionService();
    const conv = conversation();

    await expect(
      service.startLocalSession({
        conversation: conv,
        cwd: tmpdir(),
        shellProfile: shellProfile(),
      })
    ).rejects.toThrow();

    expect(emitted.some((event) => event.type === 'status' && event.status === 'error')).toBe(true);
  });

  it('uses session/resume when advertised and a provider session id exists', async () => {
    emitted.length = 0;
    const script = await writeFakeAgent(RESUME_FAKE_AGENT);
    providerConfig.acpCommand = [process.execPath, script];
    const service = new AcpSessionService();
    const conv = resumableConversation();

    await service.startLocalSession({
      conversation: conv,
      cwd: tmpdir(),
      shellProfile: shellProfile(),
    });

    expect(
      emitted.some((event) => event.type === 'session' && event.acpSessionId === 'existing-session')
    ).toBe(true);
    expect(service.getDiagnostics(conv.id)).not.toContain('unexpected session/new');
    service.stop(conv.id);
  });
});
