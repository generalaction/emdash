import { z } from 'zod';
import { stopReasonSchema } from '../session';
import { transcriptMessageSchema } from './messages';
import { transcriptThinkingSchema } from './thinking';
import {
  toolNodeSchema,
} from './tool-calls';

export const transcriptItemSchema = z.union([
  transcriptMessageSchema,
  transcriptThinkingSchema,
  toolNodeSchema,
]);
export type TranscriptItem = z.infer<typeof transcriptItemSchema>;

export const transcriptTurnInitiatorSchema = z.enum(['user', 'agent']);
export type TranscriptTurnInitiator = z.infer<typeof transcriptTurnInitiatorSchema>;

/** Successful turn reasons include ACP stop reasons plus runtime quiescence. */
export const doneTurnReasonSchema = z.union([stopReasonSchema, z.literal('quiesced')]);
export type DoneTurnReason = z.infer<typeof doneTurnReasonSchema>;

/** Cancellation is modeled as its own outcome instead of a successful stop reason. */
export const cancelledTurnReasonSchema = z.literal('cancelled');
export type CancelledTurnReason = z.infer<typeof cancelledTurnReasonSchema>;

/** Runtime-normalized failure categories that can settle a transcript turn. */
export const errorTurnReasonSchema = z.enum([
  'prompt_failed',
  'process_closed',
  'spawn_failed',
  'initialize_failed',
  'new_session_failed',
  'load_session_failed',
  'cancel_failed',
  'set_config_failed',
  'set_mode_failed',
]);
export type ErrorTurnReason = z.infer<typeof errorTurnReasonSchema>;

/** Non-error interruption reasons for turns superseded by lifecycle events. */
export const interruptedTurnReasonSchema = z.enum(['process_closed', 'replaced']);
export type InterruptedTurnReason = z.infer<typeof interruptedTurnReasonSchema>;

export const transcriptTurnOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done'), reason: doneTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('cancelled'), reason: cancelledTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('error'), reason: errorTurnReasonSchema.optional() }),
  z.object({ kind: z.literal('interrupted'), reason: interruptedTurnReasonSchema.optional() }),
]);
export type TranscriptTurnOutcome = z.infer<typeof transcriptTurnOutcomeSchema>;

export const transcriptTurnSchema = z.object({
  /** Reducer-generated turn id used to scope all item ids in this exchange. */
  id: z.string(),
  /** Stable session order, assigned when the turn opens. */
  seq: z.number().int(),
  /** Who opened the turn: a user prompt or agent-originated background activity. */
  initiator: transcriptTurnInitiatorSchema,
  items: z.array(transcriptItemSchema),
  /** Durable settlement for the whole turn; absent for replayed history without an explicit end. */
  outcome: transcriptTurnOutcomeSchema.optional(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
