import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import type { LiveTarget, ProcedureTarget } from './types';

type ProcedureClient<P> = {
  [K in keyof P]: P[K] extends (input: infer I) => infer O
    ? (input: I) => Promise<Awaited<O>>
    : never;
};

export function typedProcedures<P>(target: ProcedureTarget): ProcedureClient<P> {
  return new Proxy(
    {},
    {
      get(_, path: string) {
        if (typeof path !== 'string' || path === 'then') return undefined;
        return (input: unknown) => target.call(path, input);
      },
    }
  ) as ProcedureClient<P>;
}

export type LiveTopicDefinition<TInput, TData> = {
  readonly name: string;
  topic(input: TInput): string;
  readonly _input?: TInput;
  readonly _data?: TData;
};

export function defineLiveTopic<TInput, TData>(
  name: string,
  options: {
    serialize?: (input: TInput) => string;
  } = {}
): LiveTopicDefinition<TInput, TData> {
  return {
    name,
    topic(input) {
      const suffix = options.serialize ? options.serialize(input) : stableStringify(input);
      return suffix === undefined || suffix === '' ? name : `${name}:${suffix}`;
    },
  };
}

export type TypedLiveTarget<L> = {
  [K in keyof L]: L[K] extends LiveTopicDefinition<infer I, infer T>
    ? {
        topic(input: I): string;
        snapshot(input: I): Promise<LiveSnapshot<T>>;
        attach(input: I, push: (update: LiveUpdate) => void): Promise<Unsubscribe>;
      }
    : never;
};

export function typedLive<L extends Record<string, LiveTopicDefinition<unknown, unknown>>>(
  target: LiveTarget,
  topics: L
): TypedLiveTarget<L> {
  return new Proxy(
    {},
    {
      get(_, key: string) {
        if (typeof key !== 'string' || key === 'then') return undefined;
        const definition = topics[key];
        if (!definition) return undefined;
        return {
          topic: (input: unknown) => definition.topic(input),
          snapshot: (input: unknown) => target.snapshot(definition.topic(input)),
          attach: (input: unknown, push: (update: LiveUpdate) => void) =>
            target.attach(definition.topic(input), push),
        };
      },
    }
  ) as TypedLiveTarget<L>;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = sortForStableStringify((value as Record<string, unknown>)[key]);
  }
  return result;
}
