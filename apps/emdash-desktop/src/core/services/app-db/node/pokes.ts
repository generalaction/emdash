import type { Unsubscribe } from '@emdash/shared';
import type { PokeSubscription } from '@emdash/wire/state';

type Match<T> = (payload: T) => boolean;

export type AppDbPokeChannel<T> = {
  readonly name: string;
  poke(payload: T): void;
  subscription(match?: Match<T>): PokeSubscription;
};

export type TaskPoke = {
  projectId?: string;
  taskId?: string;
};

export type ConversationPoke = {
  projectId?: string;
  taskId?: string;
};

export type WorkspacePoke = {
  projectId?: string;
  taskId?: string;
  workspaceId?: string;
};

export type ProjectPoke = {
  projectId?: string;
};

export const appDbPokes = {
  tasks: createPokeChannel<TaskPoke>('app-db:tasks'),
  conversations: createPokeChannel<ConversationPoke>('app-db:conversations'),
  workspaces: createPokeChannel<WorkspacePoke>('app-db:workspaces'),
  projects: createPokeChannel<ProjectPoke>('app-db:projects'),
};

export function matchProject(projectId: string): Match<{ projectId?: string }> {
  return (payload) => payload.projectId === undefined || payload.projectId === projectId;
}

function createPokeChannel<T>(name: string): AppDbPokeChannel<T> {
  const listeners = new Set<(payload: T) => void>();
  return {
    name,
    poke(payload) {
      for (const listener of [...listeners]) listener(payload);
    },
    subscription(match) {
      return {
        subscribe(listener): Unsubscribe {
          const wrapped = (payload: T): void => {
            if (!match || match(payload)) listener();
          };
          listeners.add(wrapped);
          return () => listeners.delete(wrapped);
        },
      };
    },
  };
}
