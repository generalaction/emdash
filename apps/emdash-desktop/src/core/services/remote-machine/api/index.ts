import type { WorkspaceServerTarget } from '../../workspace-server/node/targets';

export {
  remoteMachineContract,
  remoteMachineServerStateSchema,
  remoteMachineServerStatusSchema,
  type RemoteMachineServerRuntime,
  type RemoteMachineServerState,
  type RemoteMachineServerStatus,
} from './contract';

export type RemoteMachineInvalidation = {
  connectionId: string;
  reason: 'reconnect-failed' | 'machine-mutation' | 'connection-lost';
  target?: WorkspaceServerTarget;
  error?: unknown;
};

export type MachineMutationEvents = {
  on(name: 'machine:mutated', handler: (event: { connectionId: string }) => void): () => void;
};
