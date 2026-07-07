import { z } from 'zod';
import { result } from '../shared/schemas';

export const ptyAgentStartInputSchema = z.object({
  /** Logical session key — used as the PTY registry key and emitted on events. */
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  /** Provider-native session id; drives resume routing per provider. */
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  /** When true the server applies resume flags (provider-specific via plugin). */
  resume: z.boolean(),
  initialPrompt: z.string().optional(),
  autoApprove: z.boolean().optional(),
  extraArgs: z.array(z.string()).optional(),
  cols: z.number().int(),
  rows: z.number().int(),
  shellSetup: z.string().optional(),
  tmuxSessionName: z.string().optional(),
});

export type PtyAgentStartInput = z.infer<typeof ptyAgentStartInputSchema>;

export const ptyOutputEventSchema = z.discriminatedUnion('kind', [
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

export type PtyOutputEvent = z.infer<typeof ptyOutputEventSchema>;

export const ptySessionStateSchema = z.object({
  conversationId: z.string(),
  providerId: z.string().optional(),
  status: z.enum(['starting', 'running', 'exited']),
  pid: z.number().int().optional(),
  cols: z.number().int(),
  rows: z.number().int(),
  isRemote: z.boolean().optional(),
  title: z.string().optional(),
  /** Unix ms timestamp when the session was started. */
  startedAt: z.number().int(),
  exit: z
    .object({
      exitCode: z.number().int().nullable(),
      signal: z.union([z.number().int(), z.string()]).optional(),
    })
    .optional(),
});

export type PtySessionState = z.infer<typeof ptySessionStateSchema>;

export const ptySessionListSchema = z.record(z.string(), ptySessionStateSchema);

export type PtySessionList = z.infer<typeof ptySessionListSchema>;

export const ptyAgentErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unknown-provider'), providerId: z.string() }),
  /** Provider plugin has no PTY prompt capability. */
  z.object({ type: z.literal('no-command'), providerId: z.string() }),
  z.object({ type: z.literal('already-running'), conversationId: z.string() }),
  z.object({ type: z.literal('not-found'), conversationId: z.string() }),
  z.object({ type: z.literal('resume-unsupported'), providerId: z.string() }),
  z.object({ type: z.literal('spawn-failed'), message: z.string() }),
]);

export type PtyAgentError = z.infer<typeof ptyAgentErrorSchema>;

export const ptyVoidResultSchema = result(z.void(), ptyAgentErrorSchema);
export const ptyStartedResultSchema = result(
  z.object({ sessionId: z.string() }),
  ptyAgentErrorSchema
);
