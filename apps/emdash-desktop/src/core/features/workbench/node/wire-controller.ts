import {
  createController,
  type Contract,
  type ContractImpl,
  type Controller,
} from '@emdash/wire/api';
import { desktopHostContract } from '../api';
import { desktopHostEvents } from './event-host';

type ContractDefinitionsOf<TContract> =
  TContract extends Contract<infer Definitions> ? Definitions : never;
type DesktopHostImpl = ContractImpl<ContractDefinitionsOf<typeof desktopHostContract>>;
export type DesktopHostControllerOperations = Omit<DesktopHostImpl, 'events'>;

export function createDesktopHostWireController(
  operations: DesktopHostControllerOperations
): Controller {
  return createController(desktopHostContract, {
    ...operations,
    events: desktopHostEvents,
  });
}
