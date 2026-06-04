import z from 'zod';

export const SHARE_MAX_PAYLOAD_BYTES = 100_000;

export const sharedSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/)
    .refine((name) => !name.includes('--'), 'Skill name cannot contain consecutive hyphens'),
  displayName: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  skillMdContent: z.string().min(1).max(SHARE_MAX_PAYLOAD_BYTES),
});

export const sharedPromptSchema = z.object({
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(SHARE_MAX_PAYLOAD_BYTES),
});

export const sharePayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('skill'),
    skill: sharedSkillSchema,
  }),
  z.object({
    type: z.literal('prompt'),
    prompt: sharedPromptSchema,
  }),
]);

export const shareTypeSchema = z.enum(['skill', 'prompt']);

export const shareFetchResponseSchema = z.object({
  id: z.string().min(1).max(64),
  createdAt: z.number().int().positive(),
  payload: sharePayloadSchema,
});

export type SharedSkill = z.infer<typeof sharedSkillSchema>;
export type SharedPrompt = z.infer<typeof sharedPromptSchema>;
export type SharePayload = z.infer<typeof sharePayloadSchema>;
export type ShareType = z.infer<typeof shareTypeSchema>;
export type ShareFetchResponse = z.infer<typeof shareFetchResponseSchema>;
