import type {
  MobileAccessBindableInterface,
  MobileAccessRuntimeState,
} from '@shared/core/mobile-access';

export const MOBILE_ACCESS_PORT_MIN = 1024;
export const MOBILE_ACCESS_PORT_MAX = 65535;

export function parseMobileAccessPort(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const port = Number(value);
  if (
    !Number.isSafeInteger(port) ||
    port < MOBILE_ACCESS_PORT_MIN ||
    port > MOBILE_ACCESS_PORT_MAX
  ) {
    return null;
  }
  return port;
}

export function preferredMobileAccessAddress(
  interfaces: readonly MobileAccessBindableInterface[],
  current: string | null
): string | null {
  if (current && interfaces.some((candidate) => candidate.address === current)) return current;
  return (
    interfaces.find((candidate) => candidate.kind !== 'loopback')?.address ??
    interfaces[0]?.address ??
    null
  );
}

export function mobileAccessStatusLabel(state: MobileAccessRuntimeState): string {
  const labels: Record<MobileAccessRuntimeState, string> = {
    disabled: 'Off',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    error: 'Error',
  };
  return labels[state];
}
