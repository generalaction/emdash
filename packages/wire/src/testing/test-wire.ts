import {
  client,
  connect,
  createController,
  memoryTransportPair,
  serve,
  withValidation,
  type Connection,
  type ContractClient,
  type ContractImpl,
  type Controller,
  type MemoryTransportPair,
  type ValidatePolicy,
} from '../api';
import type { Contract, ContractDefinitions } from '../api/define';

export type TestWire<Defs extends ContractDefinitions> = {
  client: ContractClient<Defs>;
  connection: Connection;
  controller: Controller;
  pair: MemoryTransportPair;
  dispose(): Promise<void>;
};

export function createTestWire<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  implOrController: ContractImpl<Defs> | Controller,
  options: { validate?: ValidatePolicy } = {}
): TestWire<Defs> {
  const pair = memoryTransportPair();
  const baseController = isController(implOrController)
    ? implOrController
    : createController(contract, implOrController);
  const controller = withValidation(contract, baseController, options.validate ?? 'none');
  const stopServing = serve(pair.right, controller);
  const connection = connect(pair.left);

  return {
    client: client(contract, connection),
    connection,
    controller,
    pair,
    async dispose() {
      stopServing();
      await controller.dispose?.();
      pair.left.close();
      pair.right.close();
    },
  };
}

function isController(value: unknown): value is Controller {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Controller).call === 'function' &&
    typeof (value as Controller).resolveLive === 'function'
  );
}
