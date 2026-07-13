import type { Scope } from '@emdash/shared/concurrency';
import { client } from '../api/client';
import { connect } from '../api/connect';
import type { Controller } from '../api/controller';
import type { Contract, ContractDefinitions } from '../api/define';
import { serve } from '../api/serve';
import { memoryTransportPair } from '../api/transports';
import { withValidation, type ValidatePolicy } from '../api/with-validation';
import { componentControllerSymbol, type InternalWireComponentInstance } from './internal';

export type CreateWireComponentInstanceOptions<Defs extends ContractDefinitions> = {
  scope: Scope;
  contract: Contract<Defs>;
  controller: Controller;
  validate: ValidatePolicy;
};

export function createWireComponentInstance<Defs extends ContractDefinitions>({
  scope,
  contract,
  controller,
  validate,
}: CreateWireComponentInstanceOptions<Defs>): InternalWireComponentInstance<Defs> {
  const pair = memoryTransportPair();
  const validatedController = withValidation(contract, controller, validate);
  const stopServing = serve(pair.right, validatedController);
  const connection = connect(pair.left);
  scope.add(async () => {
    stopServing();
    pair.disconnect();
    await validatedController.dispose?.();
  });

  return {
    client: client(contract, connection),
    async dispose() {
      await scope.dispose();
    },
    [componentControllerSymbol]: validatedController,
  };
}
