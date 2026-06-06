import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema';
import { taskLifecycleStatuses } from './tasks';

const issueSchema = z.object({
  provider: z.enum([
    'github',
    'linear',
    'jira',
    'gitlab',
    'plain',
    'forgejo',
    'featurebase',
    'asana',
    'monday',
    'trello',
  ]),
  url: z.string(),
  title: z.string(),
  identifier: z.string(),
  description: z.string().optional(),
  context: z.string().optional(),
  branchName: z.string().optional(),
  status: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  project: z.string().optional(),
  updatedAt: z.string().optional(),
  fetchedAt: z.string().optional(),
});

const v1Schema = z.object({
  version: z.literal('1'),
  name: z.string(),
  linkedIssue: issueSchema.optional(),
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
