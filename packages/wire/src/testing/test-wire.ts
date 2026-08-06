import type { ContractImpl, Controller } from '../api/controller';
import type { Contract, ContractDefinitions } from '../api/define';
import {
  createInProcessWire,
  type CreateInProcessWireOptions,
  type InProcessWire,
} from '../api/in-process-wire';

export type TestWire<Defs extends ContractDefinitions> = InProcessWire<Defs>;

export function createTestWire<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  implOrController: ContractImpl<Defs> | Controller,
  options: CreateInProcessWireOptions = {}
): TestWire<Defs> {
  return createInProcessWire(contract, implOrController, options);
}
