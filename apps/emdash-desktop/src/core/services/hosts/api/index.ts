import type { WorkspaceServerTarget } from './targets';

export type {
  LocalWorkspaceServerTarget,
  SshWorkspaceServerTarget,
  WorkspaceServerTarget,
} from './targets';

export {
  remoteMachineContract,
  remoteMachineDomain,
  remoteMachineServerStateSchema,
  remoteMachineServerStatusSchema,
  isServerUsable,
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
