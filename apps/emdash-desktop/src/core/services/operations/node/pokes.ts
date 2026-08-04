import type { SerializedHostRef } from '@emdash/core/primitives/host/api';
import type { TerminalOperationStatus } from '@emdash/core/primitives/kernel/api';
import { pokeChannel } from '@emdash/wire';

type Match<T> = (payload: T) => boolean;

export type OperationTreePoke = {
  projectId?: string;
};

export type OperationSettledPoke = {
  hostRef: SerializedHostRef;
  repoPath: string;
  status: TerminalOperationStatus;
};

export const operationsPokes = {
  trees: pokeChannel<OperationTreePoke>('operations:trees'),
};

const settledListeners = new Set<(event: OperationSettledPoke) => void>();

export function onOperationSettled(listener: (event: OperationSettledPoke) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function publishOperationSettled(event: OperationSettledPoke): void {
  for (const listener of settledListeners) listener(event);
}

export function matchOperationProject(projectId: string | undefined): Match<OperationTreePoke> {
  return (payload) =>
    projectId === undefined || payload.projectId === undefined || payload.projectId === projectId;
}
