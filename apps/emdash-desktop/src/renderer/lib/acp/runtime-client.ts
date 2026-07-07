import {
  acpLiveTopics,
  type AcpLiveTopics,
  type AcpProcedures,
  type StartSessionInput,
} from '@emdash/core/acp/client';
import { typedLive, typedProcedures, type TypedLiveTarget } from '@emdash/core/wire';
import { ipcWire } from '@renderer/lib/wire/ipc-wire';

const acpWire = ipcWire('acp');

export const acpRuntimeProcedures = typedProcedures<AcpProcedures>(acpWire.procedures);
export const acpRuntimeLive = typedLive<AcpLiveTopics>(acpWire.live, acpLiveTopics);

export type AcpRuntimeRpcClient = typeof acpRuntimeProcedures;
export type AcpRuntimeLiveClient = TypedLiveTarget<AcpLiveTopics>;
export type { StartSessionInput };

export function getAcpRuntimeClient(): Promise<AcpRuntimeRpcClient> {
  return Promise.resolve(acpRuntimeProcedures);
}

export function getAcpRuntimeLive(): AcpRuntimeLiveClient {
  return acpRuntimeLive;
}

export function resetAcpRuntimeClient(): void {}
