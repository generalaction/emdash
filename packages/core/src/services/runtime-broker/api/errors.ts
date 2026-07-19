import { z } from 'zod';
import { hostRefSchema, type HostRef } from '../../../primitives/host/api';

export const runtimeResolveErrorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host-unavailable'),
    host: hostRefSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal('not-configured'),
    host: hostRefSchema,
    message: z.string(),
  }),
]);

export type RuntimeResolveError = z.output<typeof runtimeResolveErrorSchema>;

export function runtimeHostUnavailable(host: HostRef, message: string): RuntimeResolveError {
  return { type: 'host-unavailable', host, message };
}

export function runtimeHostNotConfigured(host: HostRef, message: string): RuntimeResolveError {
  return { type: 'not-configured', host, message };
}

export function isRuntimeResolveError(value: unknown): value is RuntimeResolveError {
  return runtimeResolveErrorSchema.safeParse(value).success;
}

/**
 * Adapts resolver failures for main-internal and live-attachment paths that cannot return Result.
 * Wire serializes thrown Errors as name/message/stack, so `type` and `host` do not survive the
 * process boundary; renderer-visible procedures must return RuntimeResolveError in a Result.
 */
export function runtimeResolveErrorAsError(
  error: RuntimeResolveError
): Error & RuntimeResolveError {
  return Object.assign(new Error(error.message), error);
}
