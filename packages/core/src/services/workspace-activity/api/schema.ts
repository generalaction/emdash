import { z } from 'zod';

export const sessionActivityStatusSchema = z.enum(['starting', 'running', 'exited']);

export const sessionInfoSchema = z.object({
  runtime: z.string().min(1),
  sessionId: z.string().min(1),
  workspacePath: z.string().min(1),
  status: sessionActivityStatusSchema,
  startedAt: z.number().int(),
});

export const workspaceActivityKeySchema = z.object({
  path: z.string().min(1),
});

export const runtimeActivityKeySchema = z.object({});

export const runtimeSessionsSchema = z.array(sessionInfoSchema);

export const workspaceActivitySchema = z.object({
  sessions: z.array(sessionInfoSchema),
});

export type SessionActivityStatus = z.infer<typeof sessionActivityStatusSchema>;
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export type WorkspaceActivityKey = z.infer<typeof workspaceActivityKeySchema>;
export type WorkspaceActivity = z.infer<typeof workspaceActivitySchema>;
