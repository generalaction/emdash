import { createRPCClient } from '../../shared/ipc/rpc';
import type { RpcRouter } from '../../main/ipc/dbIpc';

const invoke = (window.electronAPI as unknown as { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }).invoke;

export const rpc = createRPCClient<RpcRouter>(invoke);
