import type { SessionMcpServer } from '#runtimes/acp/api';
import type { SessionCell } from '#runtimes/acp/node/session/cell';
import type { SessionLiveModels } from '#runtimes/acp/node/state/live-models';
import type { AcpStartInput } from './types';

export type ConfigDimension = 'model' | 'effort';
export type ConfigOverrides = Partial<Record<ConfigDimension, string>>;

export interface RetainedConversation {
  conversationId: string;
  descriptor: AcpStartInput;
  configOverrides: ConfigOverrides;
  initialQueueConsumed: boolean;
  everMaterialized: boolean;
  deleted: boolean;
  projection: SessionLiveModels;
  releaseProjection: () => void;
  materializationAbort?: AbortController;
}

export interface ConnectionLeaseState {
  release: boolean;
}

export interface SessionRecord {
  retained: RetainedConversation;
  input: AcpStartInput;
  resumeOutcome: 'loaded' | 'replaced-by-new' | null;
  processKey: string;
  processGeneration: number;
  connectionLeaseState: ConnectionLeaseState;
  cell: SessionCell;
  mcpServers: SessionMcpServer[];
  machineStateBinding: { dispose(): void };
  disposed: boolean;
}
