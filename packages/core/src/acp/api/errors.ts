import { z } from 'zod';

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

export const acpRuntimeErrorSchema = z.union([
  plainTagErrorSchema('provider_unsupported'),
  plainTagErrorSchema('conversation_not_found'),
  plainTagErrorSchema('no_active_session'),
  plainTagErrorSchema('invalid_state'),
  failedErrorSchema('spawn_failed'),
  failedErrorSchema('initialize_failed'),
  failedErrorSchema('new_session_failed'),
  failedErrorSchema('load_session_failed'),
  failedErrorSchema('prompt_failed'),
  failedErrorSchema('cancel_failed'),
  failedErrorSchema('set_config_failed'),
  failedErrorSchema('set_mode_failed'),
]);
