import { agentConfigContract, type AgentConfigContract } from '@emdash/core/workspace-server';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { lazyWorker, resolveWorkerEntry, type WorkerHandle } from '@emdash/wire/worker';
import { app, ipcMain, MessageChannelMain } from 'electron';

const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

const agentConfigWorker = lazyWorker(
  () => ({
    name: 'agent-config',
    contract: agentConfigContract,
    entry: resolveWorkerEntry('agent-config', __dirname),
    env: process.env,
  }),
  {
    onSpawned: (handle) => installRendererWire(handle.client),
  }
);

type AgentConfigRuntimeHandle = WorkerHandle<AgentConfigContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;

let beforeQuitRegistered = false;
let rendererWireDispose: (() => void) | null = null;

export async function initializeAgentConfigRuntimeProcess(): Promise<AgentConfigRuntimeHandle> {
  registerBeforeQuit();
  return agentConfigWorker.get();
}

function registerBeforeQuit(): void {
  if (beforeQuitRegistered) return;
  beforeQuitRegistered = true;
  app.once('before-quit', () => {
    void disposeAgentConfigRuntimeProcess();
  });
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
  await agentConfigWorker.dispose();
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
