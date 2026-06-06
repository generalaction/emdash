import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { taskConfig } from '@shared/task-config';
import { workspaceConfig } from '@shared/workspace-config';

// ---------------------------------------------------------------------------
// Trigger config
// ---------------------------------------------------------------------------

export const triggerConfigSchema = z.object({
  expr: z.string(),
  tz: z.string().optional(),
});

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const automationTriggerConfig = defineVersionedSchema()
  .unversioned(triggerConfigSchema)
  .build();

// ---------------------------------------------------------------------------
// Automation conversation config (distinct from the conversation-config module)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stored automation task config — nests task config and workspace config
// ---------------------------------------------------------------------------

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
