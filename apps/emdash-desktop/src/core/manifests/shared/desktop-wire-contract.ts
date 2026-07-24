import { defineContract } from '@emdash/wire';
import { desktopDomainContracts } from './domain-contracts';

export const desktopWireContract = defineContract(desktopDomainContracts);

export type DesktopWireContract = typeof desktopWireContract;
