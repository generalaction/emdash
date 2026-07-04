import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { loopConfigV1Schema } from './loops';

export const loopConfig = defineVersionedSchema().initial('1', loopConfigV1Schema).build();

export const loopConfigSchema = loopConfig.schema;
