import { join } from 'node:path';
import { acpApiContract, type AcpApiContract, type AcpStartInputWire } from '@emdash/core/acp';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { lazyWorker, type WorkerHandle } from '@emdash/wire/worker';
import { app, ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { log } from '@main/lib/logger';
import { desktopWorkerPath } from '@main/worker-manifest';

const ACP_WIRE_CHANNEL = 'acp-wire';

export type AcpRuntimeClient = ContractClient<AcpApiContract>;
type AcpRuntimeHandle = WorkerHandle<AcpApiContract> & { readonly client: AcpRuntimeClient };

const acpRuntimeScope = appScope.child('acp-runtime-host');
const acpWorker = lazyWorker(
  () => ({
    name: 'acp',
    contract: acpApiContract,
    entry: desktopWorkerPath('acp'),
    scope: acpRuntimeScope,
    env: {
      ...process.env,
      EMDASH_ACP_ATTACHMENTS_DIR: join(app.getPath('userData'), 'acp-attachments'),
    },
  }),
  {
    onSpawned: (handle) =>
      installRendererWire(withSessionIdPersistence(withProviderEnv(handle.client))),
  }
);

let rendererWireDispose: (() => void) | null = null;

export async function initializeAcpRuntimeProcess(): Promise<AcpRuntimeHandle> {
  return decorateAcpRuntimeHandle(await acpWorker.get());
}

export async function getAcpRuntimeClient(): Promise<AcpRuntimeClient> {
  return (await initializeAcpRuntimeProcess()).client;
}

export async function disposeAcpRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  await acpWorker.dispose();
}

function decorateAcpRuntimeHandle(handle: WorkerHandle<AcpApiContract>): AcpRuntimeHandle {
  return { ...handle, client: withSessionIdPersistence(withProviderEnv(handle.client)) };
}

/**
 * Injects the user's per-provider environment variables (configured in Settings and
 * stored in the app DB) into ACP session-start inputs. The ACP runtime worker has no
 * DB access, so this main-process choke point resolves the config and threads it to
 * the provider spawn. User-configured values take precedence over any inline env.
 */
function withProviderEnv(client: AcpRuntimeClient): AcpRuntimeClient {
  const enrich = async <T extends { input: AcpStartInputWire }>(input: T): Promise<T> => {
    const providerConfig = await providerOverrideSettings.getItem(input.input.providerId);
    const customEnv = providerConfig?.env;
    if (!customEnv || Object.keys(customEnv).length === 0) return input;
    return { ...input, input: { ...input.input, env: { ...input.input.env, ...customEnv } } };
  };
  return {
    ...client,
    startSession: async (input, meta) => client.startSession(await enrich(input), meta),
    resumeSession: async (input, meta) => client.resumeSession(await enrich(input), meta),
  };
}

function withSessionIdPersistence(client: AcpRuntimeClient): AcpRuntimeClient {
  return {
    ...client,
    startSession: async (input, meta) => {
      const result = await client.startSession(input, meta);
      if (result.success) {
        await persistReturnedSessionId(input.input.conversationId, result.data.sessionId);
      }
      return result;
    },
    resumeSession: async (input, meta) => {
      const result = await client.resumeSession(input, meta);
      if (result.success) {
        await persistReturnedSessionId(input.input.conversationId, result.data.sessionId);
      }
      return result;
    },
  };
}

async function persistReturnedSessionId(conversationId: string, sessionId: string): Promise<void> {
  const result = await setSessionId(conversationId, sessionId);
  if (!result.success) {
    log.warn('ACP runtime failed to persist returned session id', {
      conversationId,
      error: result.error,
    });
  }
}

function installRendererWire(client: AcpRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    acpApiContract,
    forwardController(acpApiContract, client),
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
    { channel: ACP_WIRE_CHANNEL }
  );
}

function runtimeWireValidationPolicy() {
  return import.meta.env.DEV ? 'full' : 'inputs';
}
