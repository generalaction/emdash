import z from 'zod';
import { taskConfigSchema } from '@shared/task-config';
import { workspaceConfigSchema } from '@shared/workspace-config';

export const triggerConfigSchema = z.object({
  expr: z.string(),
  tz: z.string().optional(),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const conversationConfigSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  title: z.string().optional(),
  autoApprove: z.boolean(),
});

export type ConversationConfig = z.infer<typeof conversationConfigSchema>;

export const storedAutomationTaskConfigSchema = z.object({
  version: z.literal('1'),
  taskConfig: taskConfigSchema,
  workspaceConfig: workspaceConfigSchema,
});

export type StoredAutomationTaskConfig = z.infer<typeof storedAutomationTaskConfigSchema>;
