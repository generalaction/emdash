import { result } from '@workspace-server/shared/schemas';
import { runtimeUnavailableErrorSchema } from '@workspace-server/shared/schemas';
import { z } from 'zod';

export const tuiAgentStartInputSchema = z.object({
  /** Logical session key — used as the PTY registry key and emitted on events. */
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  /** Provider-native session id; drives resume routing per provider. */
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  initialPrompt: z.string().optional(),
  autoApprove: z.boolean().optional(),
  extraArgs: z.array(z.string()).optional(),
  providerVars: z.record(z.string(), z.string()).optional(),
  cols: z.number().int(),
  rows: z.number().int(),
  shellSetup: z.string().optional(),
  tmuxSessionName: z.string().optional(),
});

export type TuiAgentStartInput = z.infer<typeof tuiAgentStartInputSchema>;

export const tuiResumeOutcomeSchema = z.enum(['resumed', 'attached', 'fresh-fallback']);

export type TuiResumeOutcome = z.infer<typeof tuiResumeOutcomeSchema>;

export const tuiOutputEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chunk'),
    data: z.string(),
    /** Monotonic byte offset of the first byte of this chunk in the full output log. */
    offset: z.number().int(),
  }),
  z.object({
    kind: z.literal('reset'),
    /** Full retained ring-buffer content, delivered when the requested offset is stale. */
    data: z.string(),
    offset: z.number().int(),
  }),
  z.object({
    kind: z.literal('exit'),
    exitCode: z.number().int().nullable(),
    signal: z.union([z.number().int(), z.string()]).optional(),
  }),
]);

export type TuiOutputEvent = z.infer<typeof tuiOutputEventSchema>;

export const tuiSessionResumeStateSchema = z.object({
  requested: z.boolean(),
  outcome: z.enum(['pending', 'resumed', 'fresh-fallback']),
  reason: z.string().optional(),
});

export type TuiSessionResumeState = z.infer<typeof tuiSessionResumeStateSchema>;

export const tuiSessionStateSchema = z.object({
  conversationId: z.string(),
  providerId: z.string().optional(),
  /** Provider-native session id, published from the provider hook stream. */
  sessionId: z.string().nullable(),
  status: z.enum(['starting', 'running', 'exited']),
  pid: z.number().int().optional(),
  cols: z.number().int(),
  rows: z.number().int(),
  isRemote: z.boolean().optional(),
  title: z.string().optional(),
  resume: tuiSessionResumeStateSchema.nullable(),
  /** Unix ms timestamp when the session was started. */
  startedAt: z.number().int(),
  lastInputAt: z.number().int().optional(),
  lastOutputAt: z.number().int().optional(),
  exit: z
    .object({
      exitCode: z.number().int().nullable(),
      signal: z.union([z.number().int(), z.string()]).optional(),
    })
    .optional(),
});

export type TuiSessionState = z.infer<typeof tuiSessionStateSchema>;

export const tuiSessionListSchema = z.record(z.string(), tuiSessionStateSchema);

export type TuiSessionList = z.infer<typeof tuiSessionListSchema>;

export const tuiNotificationStatusSchema = z.enum([
  'idle',
  'working',
  'awaiting-input',
  'error',
  'completed',
]);

export type TuiNotificationStatus = z.infer<typeof tuiNotificationStatusSchema>;

export const tuiNotificationStateSchema = z.object({
  conversationId: z.string(),
  status: tuiNotificationStatusSchema,
  notificationType: z
    .enum(['permission_prompt', 'idle_prompt', 'auth_success', 'elicitation_dialog'])
    .optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  lastAssistantMessage: z.string().optional(),
  at: z.number().int(),
});

export type TuiNotificationState = z.infer<typeof tuiNotificationStateSchema>;

export const tuiNotificationListSchema = z.record(z.string(), tuiNotificationStateSchema);

export type TuiNotificationList = z.infer<typeof tuiNotificationListSchema>;

export const tuiHookEventInputSchema = z.object({
  conversationId: z.string(),
  eventType: z.string(),
  body: z.record(z.string(), z.unknown()),
});

export type TuiHookEventInput = z.infer<typeof tuiHookEventInputSchema>;

export const tuiUnknownProviderErrorSchema = z.object({
  type: z.literal('unknown-provider'),
  providerId: z.string(),
});
/** Provider plugin has no TUI prompt capability. */
export const tuiNoCommandErrorSchema = z.object({
  type: z.literal('no-command'),
  providerId: z.string(),
});
export const tuiNotFoundErrorSchema = z.object({
  type: z.literal('not-found'),
  conversationId: z.string(),
});

export const tuiStartSessionErrorSchema = z.discriminatedUnion('type', [
  tuiUnknownProviderErrorSchema,
  tuiNoCommandErrorSchema,
  runtimeUnavailableErrorSchema,
]);
export const tuiResumeSessionErrorSchema = tuiStartSessionErrorSchema;
export const tuiSessionControlErrorSchema = runtimeUnavailableErrorSchema;
export const tuiInputErrorSchema = z.discriminatedUnion('type', [
  tuiNotFoundErrorSchema,
  runtimeUnavailableErrorSchema,
]);
export const tuiAgentErrorSchema = z.discriminatedUnion('type', [
  tuiUnknownProviderErrorSchema,
  tuiNoCommandErrorSchema,
  tuiNotFoundErrorSchema,
  runtimeUnavailableErrorSchema,
]);

export type TuiAgentError = z.infer<typeof tuiAgentErrorSchema>;
export type TuiStartSessionError = z.infer<typeof tuiStartSessionErrorSchema>;
export type TuiResumeSessionError = z.infer<typeof tuiResumeSessionErrorSchema>;
export type TuiSessionControlError = z.infer<typeof tuiSessionControlErrorSchema>;
export type TuiInputError = z.infer<typeof tuiInputErrorSchema>;

export const tuiVoidResultSchema = result(z.void(), tuiAgentErrorSchema);
export const tuiResumeResultSchema = result(
  z.object({ outcome: tuiResumeOutcomeSchema }),
  tuiAgentErrorSchema
);
