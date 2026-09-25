import z from 'zod';
import { credentialString, optionalCredentialString } from '../../helpers/credentials';

export const clickUpAuthSchema = z.object({
  apiKey: credentialString('ClickUp personal API token is required.'),
  workspaceId: optionalCredentialString().pipe(
    z.string().regex(/^\d+$/, 'Workspace ID must contain only digits.').optional()
  ),
});

export const clickUpCredentialsSchema = clickUpAuthSchema.extend({
  workspaceId: z.string().trim().regex(/^\d+$/),
  userId: z.string().trim().regex(/^\d+$/),
});

export type ClickUpCredentials = z.infer<typeof clickUpCredentialsSchema>;

export const clickUpUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().nullish(),
  email: z.string().nullish(),
});

export const clickUpWorkspacesSchema = z.object({
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
});

const namedLocation = z.object({ name: z.string().optional(), hidden: z.boolean().optional() });

export const clickUpTaskSchema = z.object({
  id: z.string().min(1),
  custom_id: z.string().nullish(),
  name: z.string(),
  team_id: z.string().optional(),
  markdown_description: z.string().nullish(),
  description: z.string().nullish(),
  text_content: z.string().nullish(),
  status: z.object({ status: z.string(), type: z.string().optional() }).optional(),
  assignees: z.array(clickUpUserSchema).optional(),
  date_updated: z.string().nullish(),
  archived: z.boolean().optional(),
  list: namedLocation.optional(),
  folder: namedLocation.optional(),
  priority: z.object({ priority: z.string() }).nullish(),
  parent: z.string().nullish(),
  checklists: z
    .array(
      z.object({
        name: z.string(),
        items: z.array(z.object({ name: z.string(), resolved: z.boolean() })),
      })
    )
    .optional(),
  subtasks: z
    .array(z.object({ id: z.string(), custom_id: z.string().nullish(), name: z.string() }))
    .optional(),
});

export type ClickUpTask = z.infer<typeof clickUpTaskSchema>;

export const clickUpTaskPageSchema = z.object({
  tasks: z.array(clickUpTaskSchema),
  last_page: z.boolean().optional(),
});
