import type { AcpStartError, ConversationNotFoundError, SessionMcpServer } from '#runtimes/acp/api';
import type { SessionCell } from '#runtimes/acp/node/session/cell';
import type { ConversationHandle } from './conversation-handle';
import type { AcpStartInput } from './types';

export type ConfigDimension = 'model' | 'effort' | 'collaborationMode';
export type ConfigOverrides = Partial<Record<ConfigDimension, string>>;
export type ActivationStartError = AcpStartError | ConversationNotFoundError;

export interface ConnectionLeaseState {
  release: boolean;
}

export interface SessionRecord {
  conversation: ConversationHandle;
  epoch: number;
  input: AcpStartInput;
  resumeOutcome: 'loaded' | 'replaced-by-new' | null;
  clearedConfiguration: Array<'model' | 'modeId' | 'effort' | 'collaborationMode'>;
  processKey: string;
  processGeneration: number;
  connectionLeaseState: ConnectionLeaseState;
  cell: SessionCell;
  mcpServers: SessionMcpServer[];
  machineStateBinding: { dispose(): void };
  disposed: boolean;
}
