import type { LiveCursorEntry } from '../protocol';
import type {
  LiveMutationData,
  LiveMutationDefinitions,
  LiveMutationError,
  LiveMutationInput as DefinitionInput,
} from './define';
import { createMutationId, type LiveMutationResult } from './handler';
import type { LiveBindingRegistry } from './registry';

type LiveMutationName<Defs extends LiveMutationDefinitions> = Extract<keyof Defs, string>;

export type LiveMutationCaller<Defs extends LiveMutationDefinitions> = (
  name: LiveMutationName<Defs>,
  input: DefinitionInput<Defs[LiveMutationName<Defs>]> & { mutationId: string }
) => Promise<
  LiveMutationResult<
    LiveMutationData<Defs[LiveMutationName<Defs>]>,
    LiveMutationError<Defs[LiveMutationName<Defs>]>
  >
>;

export type LiveMutationInvocation<D, E> = {
  result: LiveMutationResult<D, E>;
  settled: Promise<void>;
};

export type LiveMutationsClient<Defs extends LiveMutationDefinitions> = {
  [Name in Extract<keyof Defs, string>]: (
    input: DefinitionInput<Defs[Name]>
  ) => Promise<LiveMutationInvocation<LiveMutationData<Defs[Name]>, LiveMutationError<Defs[Name]>>>;
};

export function createLiveMutationsClient<Defs extends LiveMutationDefinitions>(
  defs: Defs,
  caller: LiveMutationCaller<Defs>,
  bindingRegistry: LiveBindingRegistry
): LiveMutationsClient<Defs> {
  const client: Partial<LiveMutationsClient<Defs>> = {};
  for (const name of Object.keys(defs) as Array<Extract<keyof Defs, string>>) {
    client[name] = async (input) => {
      const mutationId = createMutationId();
      const result = (await caller(
        name,
        Object.assign({}, input, { mutationId }) as DefinitionInput<Defs[typeof name]> & {
          mutationId: string;
        }
      )) as LiveMutationResult<
        LiveMutationData<Defs[typeof name]>,
        LiveMutationError<Defs[typeof name]>
      >;
      if (!result.success) {
        return {
          result,
          settled: Promise.resolve(),
        };
      }
      return {
        result,
        settled: settleCursors(bindingRegistry, mutationId, result.data.cursors),
      };
    };
  }
  return client as LiveMutationsClient<Defs>;
}

async function settleCursors(
  bindingRegistry: LiveBindingRegistry,
  mutationId: string,
  cursors: LiveCursorEntry[]
): Promise<void> {
  await Promise.all(
    cursors.map((entry) => {
      const binding = bindingRegistry.find(entry.model, entry.key);
      if (!binding) return Promise.resolve();
      return firstResolved([
        binding.waitForMutation(mutationId),
        binding.waitForCursor(entry.cursor),
      ]);
    })
  );
}

function firstResolved(promises: Promise<void>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let rejections = 0;
    let lastError: unknown;
    for (const promise of promises) {
      promise.then(resolve, (error: unknown) => {
        rejections += 1;
        lastError = error;
        if (rejections === promises.length) reject(lastError);
      });
    }
  });
}
