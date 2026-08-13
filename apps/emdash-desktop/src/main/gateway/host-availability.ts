import {
  LOCAL_HOST_REF,
  hostRef,
  hostRefEquals,
  sshConnectionIdOf,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import {
  runtimeHostNotConfigured,
  type RuntimeResolveError,
} from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { waitWithSignal } from '@emdash/shared/scheduling';
import {
  createHostAvailability,
  type HostAvailabilityService,
  type HostReadinessContext,
} from '@core/services/hosts/node/availability';
import type { HostService } from '@core/services/hosts/node/host-service';
import { translateHostPreparationError } from '@core/services/hosts/node/runtime-resolution';

export type CreateDesktopHostAvailabilityOptions = {
  scope: Scope;
  hosts: HostService;
  localReady(): Promise<void>;
};

export function createDesktopHostAvailability(
  options: CreateDesktopHostAvailabilityOptions
): HostAvailabilityService {
  const availability = createHostAvailability({
    scope: options.scope,
    readiness: {
      prepare: (host, context) => prepareDesktopHost(host, context, options),
    },
  });
  options.scope.add(
    options.hosts.onInvalidate(({ connectionId }) => {
      availability.markUnavailable(hostRef('remote', connectionId));
    })
  );
  return availability;
}

async function prepareDesktopHost(
  host: HostRef,
  context: HostReadinessContext,
  options: CreateDesktopHostAvailabilityOptions
): Promise<Result<void, RuntimeResolveError>> {
  if (hostRefEquals(host, LOCAL_HOST_REF)) {
    try {
      await waitWithSignal(options.localReady(), context.signal);
      return ok();
    } catch (error) {
      return err(translateHostPreparationError(host, 'handshaking', error));
    }
  }

  const connectionId = sshConnectionIdOf(host);
  if (!connectionId) {
    return err(runtimeHostNotConfigured(host, 'Host runtime is not configured'));
  }

  let phase: 'connecting' | 'provisioning' | 'handshaking' = 'connecting';
  try {
    await options.hosts.client(connectionId, {
      signal: context.signal,
      onPhase(nextPhase) {
        phase = nextPhase;
        context.setPhase(nextPhase);
      },
    });
    return ok();
  } catch (error) {
    return err(translateHostPreparationError(host, phase, error));
  }
}
