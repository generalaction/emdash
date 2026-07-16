import { isIPv4 } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type {
  MobileAccessBindableInterface,
  MobileAccessInterfaceKind,
} from '@shared/core/mobile-access';

export type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

function classifyAddress(address: string): MobileAccessInterfaceKind | null {
  if (!isIPv4(address)) return null;

  const [first, second] = address.split('.').map(Number);
  if (first === 127) return 'loopback';
  if (first === 100 && second >= 64 && second <= 127) return 'vpn';
  if (first === 10) return 'private';
  if (first === 172 && second >= 16 && second <= 31) return 'private';
  if (first === 192 && second === 168) return 'private';
  return null;
}

export function listBindableMobileAccessInterfaces(
  interfaces: NetworkInterfaceMap = networkInterfaces()
): MobileAccessBindableInterface[] {
  const seen = new Set<string>();
  const result: MobileAccessBindableInterface[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const kind = classifyAddress(entry.address);
      if (!kind || seen.has(entry.address)) continue;
      seen.add(entry.address);
      result.push({ name, address: entry.address, kind });
    }
  }

  return result.sort((left, right) =>
    left.name === right.name
      ? left.address.localeCompare(right.address)
      : left.name.localeCompare(right.name)
  );
}

export function isBindableMobileAccessAddress(
  address: string,
  interfaces: NetworkInterfaceMap = networkInterfaces()
): boolean {
  return listBindableMobileAccessInterfaces(interfaces).some((entry) => entry.address === address);
}
