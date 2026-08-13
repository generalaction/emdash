import { hostRefSchema, type HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorSchema,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import type { Result } from '@emdash/shared';
import type { Readable } from '@emdash/wire/state';
import { z } from 'zod';

export const hostAvailabilityStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unavailable'),
    issue: runtimeResolveErrorSchema.optional(),
    recovery: z.enum(['eligible', 'waiting', 'manual', 'blocked']),
    nextAttemptAt: z.number().optional(),
  }),
  z.object({
    kind: z.literal('preparing'),
    phase: z.enum(['connecting', 'provisioning', 'handshaking']),
    attempt: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('ready'),
    generation: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('suspended'),
    reason: z.literal('user-disconnected'),
  }),
]);

export const hostReadySchema = z.object({
  host: hostRefSchema,
  generation: z.number().int().positive(),
});

export type HostAvailabilityState = z.output<typeof hostAvailabilityStateSchema>;
export type HostReady = z.output<typeof hostReadySchema>;
export type HostPreparingPhase = Extract<HostAvailabilityState, { kind: 'preparing' }>['phase'];
export type RecoveryCause = 'demand' | 'connect' | 'retry' | 'ssh-edge' | 'online' | 'focus';
export type ExplicitRecoveryCause = Extract<RecoveryCause, 'connect' | 'retry'>;

export interface HostAvailability {
  state(host: HostRef): Readable<HostAvailabilityState>;
  stateFor(host: HostRef): HostAvailabilityState;
  requireReady(host: HostRef): Result<HostReady, RuntimeResolveError>;
  ensureReady(host: HostRef, cause: RecoveryCause): Promise<Result<HostReady, RuntimeResolveError>>;
  requestReady(host: HostRef, cause: ExplicitRecoveryCause): void;
  invalidate(host: HostRef, issue?: RuntimeResolveError): void;
  suspend(host: HostRef): void;
}
