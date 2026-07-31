import type { Unsubscribe } from '@emdash/shared';

export type PokeSubscription = {
  subscribe(listener: () => void): Unsubscribe;
};

export type PokeChannel = {
  readonly name: string;
  poke(): void;
  subscription(): PokeSubscription;
};

export function pokeChannel(name: string): PokeChannel {
  const listeners = new Set<() => void>();
  return {
    name,
    poke() {
      for (const listener of [...listeners]) listener();
    },
    subscription() {
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
  };
}
