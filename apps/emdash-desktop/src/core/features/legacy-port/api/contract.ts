import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  LegacyImportSource,
  LegacyPortPreview,
} from '@core/primitives/legacy-port/api/legacy-port';
import type { StartupDataGateStatus } from '@core/primitives/legacy-port/api/startup-data-gate';

export const legacyPortContract = defineContract({
  checkStatus: procedure({
    input: z.void(),
    output: z.custom<{
      hasLegacyDb: boolean;
      hasBetaDb: boolean;
      hasImportSources: boolean;
      portStatus: StartupDataGateStatus | null;
      hasExistingData: boolean;
    }>(),
  }),
  getPreview: procedure({ input: z.void(), output: z.custom<LegacyPortPreview>() }),
  runImport: procedure({
    input: z.object({
      sources: z.array(z.custom<LegacyImportSource>()).optional(),
      conflictChoices: z.record(z.string(), z.custom<LegacyImportSource>()).optional(),
    }),
    output: z.custom<{ success: boolean; error?: string }>(),
  }),
});
