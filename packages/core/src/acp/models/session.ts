import { z } from 'zod';
import { attachmentRefSchema, stopReasonSchema } from './common';
import { acpPermissionRequestSchema } from './permissions';

export const sessionLifecycleSchema = z.enum([
  'starting',
  'replaying',
  'ready',
  'working',
  'cancelling',
  'closed',
]);
export type SessionLifecycle = z.infer<typeof sessionLifecycleSchema>;

export const queuedPromptSummarySchema = z.object({
  /** Matches the internal queued prompt id, but omits inline attachment bytes. */
  id: z.string(),
  text: z.string(),
  /** Attachment metadata only; queued prompt bytes remain internal to the runtime. */
  attachments: z.array(attachmentRefSchema).optional(),
});
export type QueuedPromptSummary = z.infer<typeof queuedPromptSummarySchema>;

export const sessionStateSchema = z.object({
  lifecycle: sessionLifecycleSchema,
  /** Current control-plane turn id, or null when no prompt/replay turn is active. */
  activeTurnId: z.string().nullable(),
  pendingPermissions: z.array(acpPermissionRequestSchema),
  /** Last ACP prompt stop reason observed by the machine; separate from transcript outcomes. */
  lastStopReason: stopReasonSchema.nullable(),
  /** Prompts accepted while busy, projected without attachment bytes. */
  queuedPrompts: z.array(queuedPromptSummarySchema),
  /** True while agent-originated updates are still arriving outside a user prompt turn. */
  agentTurnActive: z.boolean(),
  /** Count of running background subagents, used for affordances and busy state. */
  backgroundAgentCount: z.number().int(),
  /** Machine-owned UI affordance: true while foreground or background work is active. */
  isGenerating: z.boolean(),
  /** Machine-owned UI affordance: true when a prompt may be accepted or queued. */
  canSubmit: z.boolean(),
  /** Machine-owned UI affordance: true when there is cancellable foreground/agent work. */
  canCancel: z.boolean(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
