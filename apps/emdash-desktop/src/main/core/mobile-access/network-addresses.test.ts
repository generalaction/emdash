import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  isBindableMobileAccessAddress,
  listBindableMobileAccessInterfaces,
  type NetworkInterfaceMap,
} from './network-addresses';

function interfaceInfo(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

describe('mobile access network addresses', () => {
  const interfaces: NetworkInterfaceMap = {
    lo: [interfaceInfo('127.0.0.1', true), interfaceInfo('::1', true)],
    ethernet: [interfaceInfo('192.168.1.20'), interfaceInfo('203.0.113.20')],
    tailscale: [interfaceInfo('100.90.10.2')],
    linkLocal: [interfaceInfo('169.254.10.2')],
  };

  it('lists only assigned loopback, private, and CGNAT VPN IPv4 addresses', () => {
    expect(listBindableMobileAccessInterfaces(interfaces)).toEqual([
      { name: 'ethernet', address: '192.168.1.20', kind: 'private' },
      { name: 'lo', address: '127.0.0.1', kind: 'loopback' },
      { name: 'tailscale', address: '100.90.10.2', kind: 'vpn' },
    ]);
  });

  it('requires the private address to be currently assigned', () => {
    expect(isBindableMobileAccessAddress('192.168.1.20', interfaces)).toBe(true);
    expect(isBindableMobileAccessAddress('10.0.0.2', interfaces)).toBe(false);
    expect(isBindableMobileAccessAddress('0.0.0.0', interfaces)).toBe(false);
    expect(isBindableMobileAccessAddress('203.0.113.20', interfaces)).toBe(false);
  });
});
