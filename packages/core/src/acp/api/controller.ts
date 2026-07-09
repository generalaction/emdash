import { createController } from '@emdash/wire';
import type { AcpRuntime } from '../runtime/runtime';
import { createAcpProcedures } from './procedures';
import { acpApiContract } from './contract';

export function createAcpController(runtime: AcpRuntime) {
  const procedures = createAcpProcedures(runtime);
  return createController(
    acpApiContract,
    {
      ...procedures,
      sessions: runtime.sessionsLiveHost(),
      session: runtime.sessionLiveHost(),
      terminalOutput: (key) => runtime.terminalOutputLog(key.terminalId),
      authStatus: runtime.authStatusLiveHost(),
      loginOutput: (key) => runtime.loginOutputLog(key.providerId),
    },
    { validate: 'full' }
  );
}
