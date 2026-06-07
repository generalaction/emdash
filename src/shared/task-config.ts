import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { linkedIssue } from './core/linked-issue';
import { taskLifecycleStatuses } from './core/tasks/tasks';

const v1Schema = z.object({
  version: z.literal('1'),
  name: z.string(),
  linkedIssue: linkedIssue.asNested().optional(),
  initialConversation: z
    .object({
      id: z.string(),
      provider: z.string(),
      title: z.string().optional(),
      autoApprove: z.boolean().optional(),
      initialPrompt: z.string().optional(),
    })
    .optional(),
  initialStatus: taskLifecycleStatuses.optional(),
});

export const taskConfig = defineVersionedSchema().initial('1', v1Schema).build();

export const taskConfigSchema = taskConfig.schema;
export type TaskConfig = typeof taskConfig.Type;
