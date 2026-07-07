import { portWire } from '@emdash/core/wire';
import { exposeWire } from '@main/lib/wire/expose-wire';
import { acpRuntimeProcessHost } from './runtime-process/host';

export const acpController = exposeWire('acp', portWire(acpRuntimeProcessHost.transport()));
