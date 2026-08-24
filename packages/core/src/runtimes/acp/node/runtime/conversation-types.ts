import type { SessionMcpServer } from '#runtimes/acp/api';
import type { SessionCell } from '#runtimes/acp/node/session/cell';
import type { ConversationHandle } from './conversation-handle';
import type { AcpStartInput } from './types';

export type ConfigDimension = 'model' | 'effort';
export type ConfigOverrides = Partial<Record<ConfigDimension, string>>;

export interface ConnectionLeaseState {
  release: boolean;
}

export interface SessionRecord {
  conversation: ConversationHandle;
  epoch: number;
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
