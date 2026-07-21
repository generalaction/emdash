import { acpApiContract } from '@emdash/core/acp';
import { createController } from '@emdash/wire';
import type { ContractImpl } from '@emdash/wire';
import type { AcpRuntime } from '../runtime/runtime';
import { createAcpProcedures } from './procedures';

export function createAcpController(runtime: AcpRuntime) {
  const procedures = createAcpProcedures(runtime);
  const impl = {
    ...procedures,
    sessions: runtime.sessionsLiveHost(),
    session: runtime.sessionLiveHost(),
    terminalOutput: (key: unknown) =>
      runtime.terminalOutputLog((key as { terminalId: string }).terminalId),
  } as ContractImpl<typeof acpApiContract>;
  return createController(acpApiContract, impl);
}
