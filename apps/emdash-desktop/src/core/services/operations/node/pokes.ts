import { pokeChannel } from '@emdash/wire';

type Match<T> = (payload: T) => boolean;

export type OperationTreePoke = {
  projectId?: string;
};

export const operationsPokes = {
  trees: pokeChannel<OperationTreePoke>('operations:trees'),
};

export function matchOperationProject(projectId: string | undefined): Match<OperationTreePoke> {
  return (payload) =>
    projectId === undefined || payload.projectId === undefined || payload.projectId === projectId;
}
