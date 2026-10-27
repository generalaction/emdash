import { hostRefSchema, type HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorSchema,
  runtimeHostUnavailable,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
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
    phase: z.enum(['connecting', 'provisioning', 'handshaking', 'checking']),
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
export type HostWakeCause = Extract<RecoveryCause, 'ssh-edge' | 'online' | 'focus'>;
export type BrowserHostWakeCause = Extract<HostWakeCause, 'online' | 'focus'>;

export interface HostAvailability {
  state(host: HostRef): Readable<HostAvailabilityState>;
  stateFor(host: HostRef): HostAvailabilityState;
  requireReady(host: HostRef): Result<HostReady, RuntimeResolveError>;
  lease(host: HostRef, owner: Scope): void;
  wake(host: HostRef, cause: HostWakeCause): void;
  wakeDemanded(cause: BrowserHostWakeCause): void;
  ensureReady(host: HostRef, cause: RecoveryCause): Promise<Result<HostReady, RuntimeResolveError>>;
  requestReady(host: HostRef, cause: ExplicitRecoveryCause): void;
  invalidate(host: HostRef, issue?: RuntimeResolveError): void;
  suspend(host: HostRef): void;
}

/** Converts observed availability to an immediate result; never starts connection work. */
export function hostReadyResult(
  host: HostRef,
  state: HostAvailabilityState
): Result<HostReady, RuntimeResolveError> {
  if (state.kind === 'ready') return ok({ host, generation: state.generation });
  if (state.kind === 'unavailable' && state.issue) return err(state.issue);
  if (state.kind === 'preparing') {
    return err(
      state.phase === 'connecting'
        ? runtimeHostUnavailable(host, 'connection-failed', 'Host connection is not ready')
        : runtimeHostUnavailable(host, 'runtime-unavailable', 'Host runtime is not ready')
    );
  }
  return err(runtimeHostUnavailable(host, 'offline', 'Host is offline'));
}

export function runtimeRecoveryDisposition(
  error: RuntimeResolveError
): Extract<HostAvailabilityState, { kind: 'unavailable' }>['recovery'] {
  if (error.type !== 'host-unavailable') return 'blocked';
  switch (error.reason) {
    case 'offline':
    case 'connection-failed':
    case 'daemon-start-failed':
    case 'runtime-unavailable':
      return 'eligible';
    case 'artifact-download-failed':
    case 'install-failed':
      return 'manual';
    case 'unsupported-platform':
    case 'protocol-upgrade-client':
    case 'protocol-upgrade-server':
      return 'blocked';
  }
}

export function allowsAutomaticHostRecovery(state: HostAvailabilityState): boolean {
  return (
    state.kind !== 'suspended' &&
    (state.kind !== 'unavailable' || (state.recovery !== 'manual' && state.recovery !== 'blocked'))
  );
}
