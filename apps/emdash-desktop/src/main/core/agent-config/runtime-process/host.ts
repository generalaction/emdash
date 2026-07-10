import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { agentConfigContract } from '@emdash/core/workspace-server';
import { exposeWireToWindows, forwardController, withValidation } from '@emdash/wire/api';
import { type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { forwardRuntimeLogs, spawnRuntime } from '@emdash/wire/util/process-runtime';
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
  forwardRuntimeLogs(process, log, { source: 'agent-config-runtime' });
  process.onExit((exit) => {
    log.warn('Agent-config runtime child process exited', exit);
  });
}

function installRendererWire(client: AgentConfigRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    agentConfigContract,
    forwardController(agentConfigContract, client),
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
