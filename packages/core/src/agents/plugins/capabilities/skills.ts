import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';

const skillsDescriptorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('supported'),
    locations: z.array(
      z.object({
        relativeDir: z.string(),
        isolation: z.enum(['provider', 'shared']),
      })
    ),
  }),
  z.object({
    kind: z.literal('none'),
  }),
]);

export type SkillsDescriptor = z.infer<typeof skillsDescriptorSchema>;

export const skillsCapability = definePluginCapability()('skills', skillsDescriptorSchema, {
  kind: 'none',
});
