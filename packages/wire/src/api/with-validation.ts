import { resultSchema } from '@emdash/shared';
import type { Middleware } from '@emdash/shared/requests';
import { z } from 'zod';
import { liveCursorEntrySchema } from '../live/protocol';
import {
  isDownloadFileOpenResult,
  markDownloadFileOpen,
  type CallMeta,
  type Controller,
} from './controller';
import type {
  Contract,
  ContractDefinitions,
  DownloadFileEndpointDef,
  EndpointDef,
  LiveModelDef,
  MutationDef,
} from './define';
import { isEndpointDef } from './define';
import type { WireFileMeta } from './protocol';
import { encodeTopic, splitTopic } from './topics';

export type ValidatePolicy = 'none' | 'inputs' | 'full';

type ProcedureValidator = {
  parseInput(input: unknown): unknown;
  parseOutput?(output: unknown): unknown;
};

const jobKeySchema = z.object({ jobId: z.string() });
const jobStartOutputSchema = z.object({ jobId: z.string() });

export function withValidation<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  controller: Controller,
  policy: ValidatePolicy
): Controller {
  if (policy === 'none') return controller;

  const procedures = new Map<string, ProcedureValidator>();
  const liveKeys = new Map<string, z.ZodTypeAny>();

  collectContractValidators(contract, []);

  return {
    async call(path: string, input: unknown, meta?: CallMeta) {
      const validator = procedures.get(path);
      if (!validator) return await controller.call(path, input, meta);

      const parsedInput = validator.parseInput(input);
      const output = await controller.call(path, parsedInput, meta);
      return policy === 'full' && validator.parseOutput ? validator.parseOutput(output) : output;
    },
    resolveLive(topic: string) {
      const { refId, rawKey } = splitTopic(topic);
      const keySchema = liveKeys.get(refId);
      if (!keySchema) return controller.resolveLive(topic);

      const parsedKey = keySchema.parse(rawKey);
      return controller.resolveLive(encodeTopic(refId, parsedKey));
    },
    acquireLive(topic: string) {
      const { refId, rawKey } = splitTopic(topic);
      const keySchema = liveKeys.get(refId);
      if (!keySchema) return controller.acquireLive(topic);

      const parsedKey = keySchema.parse(rawKey);
      return controller.acquireLive(encodeTopic(refId, parsedKey));
    },
    async dispose() {
      await controller.dispose?.();
    },
  };

  function collectContractValidators(definitions: ContractDefinitions, prefix: string[]): void {
    for (const [name, def] of Object.entries(definitions)) {
      const fullPath = [...prefix, name].join('.');
      if (!isEndpointDef(def)) {
        collectContractValidators(def, [...prefix, name]);
        continue;
      }

      collectEndpointValidators(fullPath, def);
    }
  }

  function collectEndpointValidators(fullPath: string, def: EndpointDef): void {
    switch (def.kind) {
      case 'procedure':
        procedures.set(fullPath, {
          parseInput: (input) => def.input.parse(input),
          parseOutput: (output) => def.output.parse(output),
        });
        break;
      case 'downloadFile':
        procedures.set(fullPath, {
          parseInput: (input) => def.input.parse(input),
          parseOutput: (output) => parseDownloadFileOutput(def, output),
        });
        break;
      case 'uploadFile':
        procedures.set(fullPath, {
          parseInput: (input) => def.input.parse(input),
          parseOutput: (output) => resultSchema(def.result, def.error).parse(output),
        });
        break;
      case 'liveLog':
      case 'eventStream':
        liveKeys.set(def.id, def.keySchema);
        break;
      case 'liveJob':
        procedures.set(`${fullPath}.start`, {
          parseInput: (input) => def.input.parse(input),
          parseOutput: (output) => jobStartOutputSchema.parse(output),
        });
        procedures.set(`${fullPath}.cancel`, {
          parseInput: (input) => jobKeySchema.parse(input),
        });
        liveKeys.set(def.id, jobKeySchema);
        break;
      case 'liveModel':
        collectLiveModelValidators(fullPath, def);
        break;
    }
  }

  function collectLiveModelValidators(fullPath: string, def: LiveModelDef): void {
    for (const state of Object.values(def.states)) {
      liveKeys.set(state.id, def.keySchema);
    }

    for (const [mutationName, mutationDef] of Object.entries(def.mutations)) {
      procedures.set(`${fullPath}.${mutationName}`, {
        parseInput: (input) => parseLiveModelMutationInput(def, mutationDef, input),
        parseOutput: (output) => parseLiveModelMutationOutput(mutationDef, output),
      });
    }
  }
}

export function validation<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  policy: ValidatePolicy
): Middleware<Controller> {
  return (controller) => withValidation(contract, controller, policy);
}

function parseDownloadFileOutput(def: DownloadFileEndpointDef, output: unknown): unknown {
  if (isDownloadFileOpenResult(output)) {
    return {
      success: true,
      data: markDownloadFileOpen(
        def.meta.parse(output.data.meta) as WireFileMeta,
        output.data.source
      ),
    };
  }

  if (isRecord(output) && output.success === false) {
    return { success: false, error: def.error.parse(output.error) };
  }

  return z.never().parse(output);
}

function parseLiveModelMutationInput(
  group: LiveModelDef,
  def: MutationDef,
  input: unknown
): { key: unknown; input: Record<string, unknown>; mutationId?: string } {
  const envelope = input as { key?: unknown; input?: unknown; mutationId?: unknown };
  const mutationInput = def.input.parse(envelope.input);
  return {
    key: group.keySchema.parse(envelope.key),
    input: (mutationInput ?? {}) as Record<string, unknown>,
    mutationId: typeof envelope.mutationId === 'string' ? envelope.mutationId : undefined,
  };
}

function parseLiveModelMutationOutput(def: MutationDef, output: unknown): unknown {
  return resultSchema(
    z.object({ data: def.data, cursors: z.array(liveCursorEntrySchema) }),
    def.error
  ).parse(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
