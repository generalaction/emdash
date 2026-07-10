import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { agentConfigContract } from '@emdash/core/workspace-server';
import { createController, exposeWireToWindows, withValidation } from '@emdash/wire/api';
import { type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { log } from '@main/lib/logger';

const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

type AgentConfigRuntimeHandle = Awaited<ReturnType<typeof spawnAgentConfigRuntime>>;
export type AgentConfigRuntimeClient = AgentConfigRuntimeHandle['client'];

let handlePromise: Promise<AgentConfigRuntimeHandle> | null = null;
let rendererWireDispose: (() => void) | null = null;

export function initializeAgentConfigRuntimeProcess(): Promise<AgentConfigRuntimeHandle> {
  if (handlePromise) return handlePromise;
  handlePromise = spawnAgentConfigRuntime().then((handle) => {
    installRendererWire(handle.client);
    app.once('before-quit', () => {
      void disposeAgentConfigRuntimeProcess();
    });
    return handle;
  });
  return handlePromise;
}

export async function getAgentConfigRuntimeHandle(): Promise<AgentConfigRuntimeHandle> {
  return initializeAgentConfigRuntimeProcess();
}

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeClient> {
  return (await getAgentConfigRuntimeHandle()).client;
}

export async function disposeAgentConfigRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  const handle = await handlePromise;
  handlePromise = null;
  await handle?.dispose();
}

async function spawnAgentConfigRuntime() {
  const entry = resolveRuntimeEntry();
  log.info('Agent-config runtime child process entry resolved', { entry });
  const handle = await spawnRuntime({
    host: childProcessHost(),
    contract: agentConfigContract,
    spec: {
      entry,
      env: process.env,
      supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
    },
    onProcess: attachAgentConfigRuntimeLogging,
  });
  handle.onRestarted(() => {
    log.info('Agent-config runtime child process restarted');
  });
  return handle;
}

function attachAgentConfigRuntimeLogging(process: ManagedProcess): void {
  process.onStdio((stream, chunk) => {
    if (stream === 'stderr') {
      log.warn('Agent-config runtime stderr', { chunk });
    } else {
      log.debug('Agent-config runtime stdout', { chunk });
    }
  });
  process.onExit((exit) => {
    log.warn('Agent-config runtime child process exited', exit);
  });
}

function installRendererWire(client: AgentConfigRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    agentConfigContract,
    createController(agentConfigContract, {
      agents: client.agents,
      refreshAgents: (input, meta) => client.refreshAgents(input, meta),
      installAgent: client.installAgent,
      uninstallAgent: (input, meta) => client.uninstallAgent(input, meta),
      startLogin: (input, meta) => client.startLogin(input, meta),
      cancelLogin: (input, meta) => client.cancelLogin(input, meta),
      sendLoginInput: (input, meta) => client.sendLoginInput(input, meta),
      resizeLogin: (input, meta) => client.resizeLogin(input, meta),
      markUrlHandled: (input, meta) => client.markUrlHandled(input, meta),
      refreshAuthStatus: (input, meta) => client.refreshAuthStatus(input, meta),
      loginOutput: client.loginOutput,
      mcpServers: client.mcpServers,
      saveMcpServer: (input, meta) => client.saveMcpServer(input, meta),
      removeMcpServer: (input, meta) => client.removeMcpServer(input, meta),
      listMcpForAgent: (input, meta) => client.listMcpForAgent(input, meta),
      skills: client.skills,
      installSkill: (input, meta) => client.installSkill(input, meta),
      removeSkill: (input, meta) => client.removeSkill(input, meta),
      createSkill: (input, meta) => client.createSkill(input, meta),
    }),
    runtimeWireValidationPolicy()
  );
  rendererWireDispose = exposeWireToWindows(
    {
      ipcMain,
      createMessageChannel: () => {
        const channel = new MessageChannelMain();
        return { port1: channel.port1, port2: channel.port2 };
      },
    },
    controller,
    { channel: AGENT_CONFIG_WIRE_CHANNEL }
  );
}

function runtimeWireValidationPolicy() {
  return import.meta.env.DEV ? 'full' : 'inputs';
}

function resolveRuntimeEntry(): string {
  const candidates = [
    join(__dirname, 'agent-config-runtime.js'),
    join(__dirname, 'agent-config-runtime.mjs'),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      `Agent-config runtime child process entry is missing. Checked: ${candidates.join(', ')}`
    );
  }
  return entry;
}
