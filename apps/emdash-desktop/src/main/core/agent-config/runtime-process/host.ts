import { agentConfigContract, type AgentConfigContract } from '@emdash/core/workspace-server';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { lazyWorker, type WorkerHandle } from '@emdash/wire/worker';
import { ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { desktopWorkerPath } from '@main/worker-manifest';

const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

const agentConfigRuntimeScope = appScope.child('agent-config-runtime-host');
const agentConfigWorker = lazyWorker(
  () => ({
    name: 'agent-config',
    contract: agentConfigContract,
    entry: desktopWorkerPath('agent-config'),
    scope: agentConfigRuntimeScope,
    env: process.env,
  }),
  {
    onSpawned: (handle) => installRendererWire(handle.client),
  }
);

type AgentConfigRuntimeHandle = WorkerHandle<AgentConfigContract>;
export type AgentConfigRuntimeClient = ContractClient<AgentConfigContract>;

let rendererWireDispose: (() => void) | null = null;

export async function initializeAgentConfigRuntimeProcess(): Promise<AgentConfigRuntimeHandle> {
  return agentConfigWorker.get();
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
