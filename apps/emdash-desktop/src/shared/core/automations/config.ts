import z from 'zod';
import { taskConfig } from '@shared/core/tasks/task-config';
import { workspaceConfig } from '@shared/core/workspaces/workspace-config';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

export const triggerConfigSchema = z.object({
  expr: z.string(),
  tz: z.string().optional(),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const automationTriggerConfig = defineVersionedSchema()
  .unversioned(triggerConfigSchema)
  .build();

export const conversationConfigSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  title: z.string().optional(),
  autoApprove: z.boolean(),
});

export type ConversationConfig = z.infer<typeof conversationConfigSchema>;

export const automationConversationConfig = defineVersionedSchema()
  .unversioned(conversationConfigSchema)
  .build();

const storedAutomationTaskConfigV1Schema = z.object({
  version: z.literal('1'),
  taskConfig: taskConfig.asNested(),
  workspaceConfig: workspaceConfig.asNested(),
});

export const storedAutomationTaskConfig = defineVersionedSchema()
  .initial('1', storedAutomationTaskConfigV1Schema)
  .build();

export const storedAutomationTaskConfigSchema = storedAutomationTaskConfig.schema;
export type StoredAutomationTaskConfig = typeof storedAutomationTaskConfig.Type;
