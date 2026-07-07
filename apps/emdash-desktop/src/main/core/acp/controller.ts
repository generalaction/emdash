import type { AcpProcedures } from '@emdash/core/acp';
import { portWire } from '@emdash/core/wire';
import { typedProcedures } from '@emdash/core/wire';
import { exposeWire } from '@main/lib/wire/expose-wire';
import { acpRuntimeProcessHost } from './runtime-process/host';

export const acpWire = portWire(acpRuntimeProcessHost.transport());

export const acpRuntimeProcedures = typedProcedures<AcpProcedures>(acpWire.procedures);
export const acpController = exposeWire('acp', acpWire);
