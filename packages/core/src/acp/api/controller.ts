import { createController } from '@emdash/wire';
import type { AcpRuntime } from '../runtime/runtime';
import { createAcpProcedures } from './procedures';
import { acpApiContract } from './wire-contract';

export function createAcpController(runtime: AcpRuntime) {
  const procedures = createAcpProcedures(runtime);
  return createController(
    acpApiContract,
    {
      ...procedures,
      sessions: runtime.sessionsLiveHost(),
      session: runtime.sessionLiveHost(),
      terminalOutput: (key) => runtime.terminalOutputLog(key.terminalId),
    },
    { validate: 'full' }
  );
}
