import type { Unsubscribe } from '@emdash/shared';
import type { z } from 'zod';
import { stableStringify, type LiveModelKey } from '../live/mutations';
import type { LiveSource } from '../live/protocol';
import type { ContractShape, LiveLogKey, ProcedureInput, ProcedureOutput } from './define';
import { WireError } from './protocol';

export type CallMeta = {
  signal?: AbortSignal;
};

export type Controller = {
  call(path: string, input: unknown, meta?: CallMeta): Promise<unknown>;
  resolveLive(topic: string): LiveSource | null;
  liveRefIds(): readonly string[];
  dispose?(): void;
};

export type ValidatePolicy = 'none' | 'inputs' | 'full';

export type ProcedureHandlers<Contract extends ContractShape> = {
  [Name in keyof Contract['procedures']]: (
    input: ProcedureInput<Contract['procedures'][Name]>,
    meta: CallMeta
  ) =>
    | Promise<ProcedureOutput<Contract['procedures'][Name]>>
    | ProcedureOutput<Contract['procedures'][Name]>;
};

export type ModelResolvers<Contract extends ContractShape> = {
  [Name in keyof Contract['models']]: (
    key: LiveModelKey<Contract['models'][Name]>
  ) => LiveSource | null | undefined;
};

export type LogResolvers<Contract extends ContractShape> = {
  [Name in keyof Contract['logs']]: (
    key: LiveLogKey<Contract['logs'][Name]>
  ) => LiveSource | null | undefined;
};

type LiveEntry = {
  keySchema: z.ZodTypeAny;
  resolve(key: unknown): LiveSource | null | undefined;
};

export function bind<Contract extends ContractShape>(
  contract: Contract,
  impl: {
    procedures: ProcedureHandlers<Contract>;
    live: {
      models: ModelResolvers<Contract>;
      logs: LogResolvers<Contract>;
    };
  },
  options: { validate?: ValidatePolicy } = {}
): Controller {
  const validate = options.validate ?? 'none';
  const liveEntries = new Map<string, LiveEntry>();

  for (const [name, ref] of Object.entries(contract.models)) {
    const resolve = impl.live.models[name as keyof Contract['models']] as (
      key: unknown
    ) => LiveSource | null | undefined;
    liveEntries.set(ref.id, { keySchema: ref.keySchema, resolve });
  }

  for (const [name, ref] of Object.entries(contract.logs)) {
    const resolve = impl.live.logs[name as keyof Contract['logs']] as (
      key: unknown
    ) => LiveSource | null | undefined;
    liveEntries.set(ref.id, { keySchema: ref.keySchema, resolve });
  }

  return {
    async call(path, input, meta = {}) {
      const def = contract.procedures[path];
      const handler = impl.procedures[path as keyof Contract['procedures']] as
        | ((input: unknown, meta: CallMeta) => Promise<unknown> | unknown)
        | undefined;
      if (!def || !handler) {
        throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      }
      const parsedInput = validate === 'none' ? input : def.input.parse(input);
      const output = await handler(parsedInput, meta);
      return validate === 'full' ? def.output.parse(output) : output;
    },
    resolveLive(topic) {
      const { refId, rawKey } = splitTopic(topic);
      const entry = liveEntries.get(refId);
      if (!entry) return null;
      const key = validate === 'none' ? rawKey : entry.keySchema.parse(rawKey);
      return entry.resolve(key) ?? missingLiveSource(`Unknown live topic '${topic}'`);
    },
    liveRefIds() {
      return [...liveEntries.keys()];
    },
  };
}

export function encodeTopic(refId: string, key: unknown): string {
  if (key === undefined) return refId;
  return `${refId}|${stableStringify(key)}`;
}

export function splitTopic(topic: string): { refId: string; rawKey: unknown } {
  const index = topic.indexOf('|');
  if (index === -1) return { refId: topic, rawKey: undefined };
  const encoded = topic.slice(index + 1);
  return {
    refId: topic.slice(0, index),
    rawKey: encoded.length === 0 ? undefined : JSON.parse(encoded),
  };
}

export function mergeControllers(controllers: Record<string, Controller>): Controller {
  const refOwners = new Map<string, string>();
  for (const [namespace, controller] of Object.entries(controllers)) {
    for (const refId of controller.liveRefIds()) {
      const owner = refOwners.get(refId);
      if (owner) {
        throw new WireError(
          'DUPLICATE_LIVE_REF',
          `Live ref '${refId}' is registered by both '${owner}' and '${namespace}'`
        );
      }
      refOwners.set(refId, namespace);
    }
  }

  return {
    async call(path, input, meta = {}) {
      const index = path.indexOf('.');
      if (index === -1) {
        throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      }
      const namespace = path.slice(0, index);
      const child = controllers[namespace];
      if (!child) {
        throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      }
      return await child.call(path.slice(index + 1), input, meta);
    },
    resolveLive(topic) {
      const { refId } = splitTopic(topic);
      const owner = refOwners.get(refId);
      if (!owner) return null;
      return controllers[owner]?.resolveLive(topic) ?? null;
    },
    liveRefIds() {
      return [...refOwners.keys()];
    },
    dispose() {
      for (const controller of Object.values(controllers)) controller.dispose?.();
    },
  };
}

function missingLiveSource(message: string): LiveSource {
  return {
    snapshot() {
      throw new WireError('NOT_FOUND', message);
    },
    subscribe(): Unsubscribe {
      return () => {};
    },
  };
}
