import { createController, type Controller } from '@emdash/wire/api';
import type {
  LegacyImportSource,
  LegacyPortPreview,
} from '@core/primitives/legacy-port/api/legacy-port';
import type { StartupDataGateStatus } from '@core/primitives/legacy-port/api/startup-data-gate';
import { legacyPortContract } from '../api';

export type LegacyPortControllerOperations = {
  checkStatus(): Promise<{
    hasLegacyDb: boolean;
    hasBetaDb: boolean;
    hasImportSources: boolean;
    portStatus: StartupDataGateStatus | null;
    hasExistingData: boolean;
  }>;
  getPreview(): Promise<LegacyPortPreview>;
  runImport(input: {
    sources?: LegacyImportSource[];
    conflictChoices?: Record<string, LegacyImportSource>;
  }): Promise<{ success: boolean; error?: string }>;
};

export function createLegacyPortWireController(
  operations: LegacyPortControllerOperations
): Controller {
  return createController(legacyPortContract, {
    checkStatus: () => operations.checkStatus(),
    getPreview: () => operations.getPreview(),
    runImport: (input) => operations.runImport(input),
  });
}
