import { z } from 'zod';
import { promptDraftStateSchema } from '../models/prompt';

export const serializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

const plainTagErrorSchema = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), message: z.string().optional() });

const failedErrorSchema = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    message: z.string().optional(),
    cause: serializedErrorSchema.optional(),
  });

export const providerUnsupportedErrorSchema = plainTagErrorSchema('provider_unsupported');
export const conversationNotFoundErrorSchema = plainTagErrorSchema('conversation_not_found');
export const invalidStateErrorSchema = plainTagErrorSchema('invalid_state');
export const spawnFailedErrorSchema = failedErrorSchema('spawn_failed');
export const initializeFailedErrorSchema = failedErrorSchema('initialize_failed');
export const newSessionFailedErrorSchema = failedErrorSchema('new_session_failed');
export const authRequiredErrorSchema = failedErrorSchema('auth_required');
export const promptFailedErrorSchema = failedErrorSchema('prompt_failed');
export const cancelFailedErrorSchema = failedErrorSchema('cancel_failed');
export const setConfigFailedErrorSchema = failedErrorSchema('set_config_failed');
export const setModeFailedErrorSchema = failedErrorSchema('set_mode_failed');
export const promptDraftConflictErrorSchema = z.object({
  type: z.literal('prompt_draft_conflict'),
  message: z.string().optional(),
  current: promptDraftStateSchema,
});

export const acpStartSessionErrorSchema = z.union([
  providerUnsupportedErrorSchema,
  authRequiredErrorSchema,
  spawnFailedErrorSchema,
  initializeFailedErrorSchema,
  newSessionFailedErrorSchema,
  invalidStateErrorSchema,
]);
export const acpResumeSessionErrorSchema = acpStartSessionErrorSchema;
export const acpStopSessionErrorSchema = z.never();
export const acpSendPromptErrorSchema = z.union([
  conversationNotFoundErrorSchema,
  invalidStateErrorSchema,
  promptFailedErrorSchema,
]);
export const acpQueuePromptErrorSchema = z.union([
  conversationNotFoundErrorSchema,
  invalidStateErrorSchema,
]);
export const acpEditQueuedPromptErrorSchema = acpQueuePromptErrorSchema;
export const acpDeleteQueuedPromptErrorSchema = acpQueuePromptErrorSchema;
export const acpChangeQueuePromptOrderErrorSchema = acpQueuePromptErrorSchema;
export const acpResolvePermissionErrorSchema = acpQueuePromptErrorSchema;
export const acpSetPromptDraftErrorSchema = conversationNotFoundErrorSchema;
export const acpCompareAndSetPromptDraftErrorSchema = z.union([
  conversationNotFoundErrorSchema,
  promptDraftConflictErrorSchema,
]);
export const acpGetPromptDraftStateErrorSchema = conversationNotFoundErrorSchema;
export const acpCancelTurnErrorSchema = z.union([invalidStateErrorSchema, cancelFailedErrorSchema]);
export const acpSetModelOptionErrorSchema = z.union([
  conversationNotFoundErrorSchema,
  invalidStateErrorSchema,
  setConfigFailedErrorSchema,
]);
export const acpSetModeOptionErrorSchema = z.union([
  conversationNotFoundErrorSchema,
  invalidStateErrorSchema,
  setModeFailedErrorSchema,
]);
export const acpExportTranscriptErrorSchema = conversationNotFoundErrorSchema;
export const acpExportRawLogErrorSchema = conversationNotFoundErrorSchema;
export const acpAttachmentErrorSchema = invalidStateErrorSchema;
export const acpGetHistoryErrorSchema = z.never();

export const acpRuntimeErrorSchema = z.union([
  providerUnsupportedErrorSchema,
  conversationNotFoundErrorSchema,
  invalidStateErrorSchema,
  spawnFailedErrorSchema,
  initializeFailedErrorSchema,
  newSessionFailedErrorSchema,
  authRequiredErrorSchema,
  promptFailedErrorSchema,
  cancelFailedErrorSchema,
  setConfigFailedErrorSchema,
  setModeFailedErrorSchema,
  promptDraftConflictErrorSchema,
]);
