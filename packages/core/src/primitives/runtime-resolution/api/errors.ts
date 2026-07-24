import { z } from 'zod';
import { hostRefSchema, type HostRef } from '../../host/api';

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
 * Adapts resolver failures for internal paths that cannot return Result. Wire
 * procedures must return the serializable RuntimeResolveError instead.
 */
export function runtimeResolveErrorAsError(
  error: RuntimeResolveError
): Error & RuntimeResolveError {
  return Object.assign(new Error(error.message), error);
}
