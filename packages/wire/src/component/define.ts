import { assertExactRequirementKeys } from './requirements';
import {
  createWireComponentInstance,
  type CreateWireComponentInstanceOptions,
} from './instance';
import { componentControllerSymbol, wireComponentSymbol } from './symbols';
import type {
  DefineWireComponentOptions,
  InternalWireComponentInstance,
  WireComponentDefinition,
  WireComponentRequirements,
} from './types';
import type { ContractDefinitions } from '../api/define';

export function defineWireComponent<
  const Id extends string,
  const Requirements extends WireComponentRequirements,
  Defs extends ContractDefinitions,
  Config,
>(
  definition: DefineWireComponentOptions<Id, Defs, Requirements, Config>
): WireComponentDefinition<Id, Defs, Requirements, Config> {
  return Object.freeze({
    id: definition.id,
    contract: definition.contract,
    requirements: definition.requirements,
    configSchema: definition.configSchema,
    [wireComponentSymbol]: true as const,
    create(options) {
      const componentScope = options.scope.child(`component:${definition.id}`);
      const config = definition.configSchema.parse(options.config);
      assertExactRequirementKeys(
        definition.id,
        definition.requirements,
        options.dependencies as Record<string, unknown>
      );

      try {
        return definition.create({
          scope: componentScope,
          dependencies: options.dependencies,
          config,
          logger: options.logger ?? componentScope.log,
          signal: componentScope.signal,
          instance: ({ scope, controller }) => {
            const instance = createInstance({
              contract: definition.contract,
              controller,
              validate: options.validate ?? 'inputs',
              disposeScope: () => scope.dispose(),
            });
            scope.add(() => instance.dispose());
            return instance;
          },
        });
      } catch (error) {
        void componentScope.dispose(error);
        throw error;
      }
    },
  });
}

function createInstance<Defs extends ContractDefinitions>(
  options: CreateWireComponentInstanceOptions<Defs>
): InternalWireComponentInstance<Defs> {
  return createWireComponentInstance(options);
}

// Keep the helper wrapped so the public component definition exposes only create().
export { componentControllerSymbol, wireComponentSymbol };
