import z from 'zod';
import { AGENT_PROVIDER_IDS } from './agent-provider-registry';

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

const sharedTaskCreateActionSchema = z.object({
  kind: z.literal('task.create'),
  prompt: z.string().min(1).max(20_000),
});

// Field constraints mirror src/shared/automations (AUTOMATION_NAME_MAX_LENGTH,
// AutomationDeadlinePolicy, TaskCreateAction). No zod source exists there, so keep
// these in sync by hand; this file must stay alias-free for the share worker.
export const sharedAutomationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable().optional(),
  category: z.string().min(1).max(64),
  trigger: z.object({
    expr: z.string().min(1).max(256),
    tz: z.string().min(1).max(64),
  }),
  actions: z.array(sharedTaskCreateActionSchema).min(1).max(20),
  deadlinePolicy: z.enum(['next-interval', 'fixed', 'none']),
  deadlineMs: z.number().int().positive().nullable().optional(),
  /** Provider that backs the automation's tasks, so share pages can show the agent. */
  agentProviderId: z.enum(AGENT_PROVIDER_IDS).nullable().optional(),
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
  z.object({
    type: z.literal('automation'),
    automation: sharedAutomationSchema,
  }),
]);

export const shareTypeSchema = z.enum(['skill', 'prompt', 'automation']);

export const shareFetchResponseSchema = z.object({
  id: z.string().min(1).max(64),
  createdAt: z.number().int().positive(),
  payload: sharePayloadSchema,
});

export type SharedSkill = z.infer<typeof sharedSkillSchema>;
export type SharedPrompt = z.infer<typeof sharedPromptSchema>;
export type SharedAutomation = z.infer<typeof sharedAutomationSchema>;
export type SharePayload = z.infer<typeof sharePayloadSchema>;
export type ShareType = z.infer<typeof shareTypeSchema>;
export type ShareFetchResponse = z.infer<typeof shareFetchResponseSchema>;
