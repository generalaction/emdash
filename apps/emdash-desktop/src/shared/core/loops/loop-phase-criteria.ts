import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { loopPhaseCriteriaV1Schema } from './loops';

export const loopPhaseCriteria = defineVersionedSchema()
  .initial('1', loopPhaseCriteriaV1Schema)
  .build();

export const loopPhaseCriteriaSchema = loopPhaseCriteria.schema;
