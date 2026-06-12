import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';

/**
 * modelOptionSchema is used to describe a model that an agent supports.
 * @param name - The name of the model.
 * @param description - The description of the model.
 * @param modelFeatures - The features of the model.
 * @param contextWindowSize - The context window size in tokens of the model.
 * @param speed - The speed of the model. Number between 1 and 5.
 * @param intelligence - The intelligence of the model. Number between 1 and 5.
 */
export const modelOptionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  modelFeatures: z
    .object({
      contextWindowSize: z.number().optional(),
      speed: z.number().min(1).max(5).optional(),
      intelligence: z.number().min(1).max(5).optional(),
    })
    .optional(),
});

/**
 * ModelsDescriptor is used to describe the models that an agent supports.
 * @param kind - The kind of models descriptor.
 * @param modelOptions - The models that the agent supports keyed by the modelId.
 * @param kind: 'selectable' - The agent supports selecting a model.
 * @param kind: 'none' - The agent does not support selecting a model.
 */
export const modelsCapability = definePluginCapability()(
  'models',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('selectable'),
      modelOptions: z.record(z.string(), modelOptionSchema),
    }),
    z.object({
      kind: z.literal('none'),
    }),
  ])
);
