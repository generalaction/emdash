import { z } from 'zod';
import {
  conversationConfigSchema,
  storedAutomationTaskConfigSchema,
  triggerConfigSchema,
} from './config';

export const automationRuntimeAvailabilitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: z.string() }),
]);

export type AutomationRuntimeAvailability = z.infer<typeof automationRuntimeAvailabilitySchema>;

export const automationSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  name: z.string(),
  triggerConfig: triggerConfigSchema.optional(),
  conversationConfig: conversationConfigSchema.optional(),
  taskConfig: storedAutomationTaskConfigSchema.optional(),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Automation = z.infer<typeof automationSchema>;

export const createAutomationParamsSchema = z.object({
  name: z.string(),
  triggerConfig: triggerConfigSchema,
  conversationConfig: conversationConfigSchema,
  taskConfig: storedAutomationTaskConfigSchema.optional(),
  projectId: z.string(),
  enabled: z.boolean().optional(),
});

export type CreateAutomationParams = z.infer<typeof createAutomationParamsSchema>;

export const updateAutomationPatchSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  projectId: z.string().optional(),
  triggerConfig: triggerConfigSchema.optional(),
  conversationConfig: conversationConfigSchema.optional(),
  taskConfig: storedAutomationTaskConfigSchema.nullable().optional(),
});

export type UpdateAutomationPatch = z.infer<typeof updateAutomationPatchSchema>;
