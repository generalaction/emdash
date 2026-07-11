import {
  defineVersionedSchema,
  type VersionedSchema,
} from '@shared/lib/versioned-schema/versioned-schema';
import {
  LEGACY_DEFAULT_LOOP_PROVIDER,
  type LoopConfig,
  loopConfigV1Schema,
  loopConfigV2Schema,
} from './loops';

const currentLoopConfig = defineVersionedSchema()
  .initial('1', loopConfigV1Schema)
  .version('2', loopConfigV2Schema, (v1) => ({
    ...v1,
    version: '2' as const,
    provider: v1.provider ?? LEGACY_DEFAULT_LOOP_PROVIDER,
    // Historical sessions selected their provider's default model. Preserve that behavior.
    model: null,
    terminalGates: {
      review: v1.reviewEnabled,
      e2e: false,
    },
    browserPreview: {
      enabled: v1.verifiers.includes('agent-browser'),
    },
  }))
  .build();

/**
 * The v1 engine still writes v1 objects during the staged rollout. Reads upgrade to v2, but the
 * widened write type keeps Wave 0 source-compatible until the serial engine integration lands.
 */
export const loopConfig = currentLoopConfig as VersionedSchema<LoopConfig>;

export const loopConfigSchema = loopConfig.schema;
