import { client } from '../api/client';
import { connect } from '../api/connect';
import type { Controller } from '../api/controller';
import type { Contract, ContractDefinitions } from '../api/define';
import { serve } from '../api/serve';
import { memoryTransportPair } from '../api/transports';
import { withValidation, type ValidatePolicy } from '../api/with-validation';
import { componentControllerSymbol } from './symbols';
import type { InternalWireComponentInstance } from './types';

export type CreateWireComponentInstanceOptions<Defs extends ContractDefinitions> = {
  contract: Contract<Defs>;
  controller: Controller;
  validate: ValidatePolicy;
  disposeScope(): Promise<void>;
};

export function createWireComponentInstance<Defs extends ContractDefinitions>({
  contract,
  controller,
  validate,
  disposeScope,
}: CreateWireComponentInstanceOptions<Defs>): InternalWireComponentInstance<Defs> {
  const pair = memoryTransportPair();
  const validatedController = withValidation(contract, controller, validate);
  const stopServing = serve(pair.right, validatedController);
  const connection = connect(pair.left);
  let disposed = false;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    stopServing();
    pair.disconnect();
    await validatedController.dispose?.();
    await disposeScope();
  };

  return {
    client: client(contract, connection),
    async dispose() {
      await dispose();
    },
    [componentControllerSymbol]: validatedController,
  };
}
