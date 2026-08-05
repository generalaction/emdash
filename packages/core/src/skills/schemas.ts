import { z } from 'zod';

export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().optional(),
});

export const skillTargetSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('providers'), providerIds: z.array(z.string()) }),
]);

export const skillLocationSchema = z.object({
  relativeDir: z.string(),
  kind: z.enum(['canonical', 'provider', 'shared']),
  providerIds: z.array(z.string()),
  ownership: z.enum(['emdash', 'external']),
});

export const catalogSkillSchema = z.object({
  id: z.string(),
  installId: z.string().optional(),
  displayName: z.string(),
  description: z.string(),
  source: z.enum(['openai', 'anthropic', 'skillssh', 'local']),
  sourceUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  brandColor: z.string().optional(),
  defaultPrompt: z.string().optional(),
  sourceRef: z.string().optional(),
  catalogSkillId: z.string().optional(),
  skillShPath: z.string().optional(),
  installs: z.number().optional(),
  skillMdContent: z.string().optional(),
  frontmatter: skillFrontmatterSchema,
  installed: z.boolean(),
  managedByEmdash: z.boolean().optional(),
  localPath: z.string().optional(),
  locations: z.array(skillLocationSchema).optional(),
  targets: skillTargetSelectionSchema.optional(),
});

export const catalogIndexSchema = z.object({
  version: z.number(),
  lastUpdated: z.string(),
  skills: z.array(catalogSkillSchema),
});

export const skillInstallPayloadSchema = z.object({
  id: z.string(),
  installId: z.string().optional(),
  skillMdContent: z.string(),
  source: z.enum(['openai', 'anthropic', 'skillssh', 'local']).optional(),
  sourceRef: z.string().optional(),
  catalogSkillId: z.string().optional(),
  skillShPath: z.string().optional(),
  iconUrl: z.string().optional(),
  targets: skillTargetSelectionSchema.optional(),
});

export const createSkillInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  content: z.string().optional(),
  targets: skillTargetSelectionSchema.optional(),
});
