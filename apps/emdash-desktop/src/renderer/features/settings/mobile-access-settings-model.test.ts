import { describe, expect, it } from 'vitest';
import type { MobileAccessBindableInterface } from '@shared/core/mobile-access';
import {
  mobileAccessStatusLabel,
  parseMobileAccessPort,
  preferredMobileAccessAddress,
} from './mobile-access-settings-model';

const interfaces: MobileAccessBindableInterface[] = [
  { name: 'Loopback', address: '127.0.0.1', kind: 'loopback' },
  { name: 'Wi-Fi', address: '192.168.1.20', kind: 'private' },
  { name: 'Tailscale', address: '100.90.1.2', kind: 'vpn' },
];

describe('mobile access settings model', () => {
  it('accepts only unprivileged TCP ports', () => {
    expect(parseMobileAccessPort('7458')).toBe(7458);
    expect(parseMobileAccessPort('1024')).toBe(1024);
    expect(parseMobileAccessPort('65535')).toBe(65535);
    expect(parseMobileAccessPort('1023')).toBeNull();
    expect(parseMobileAccessPort('65536')).toBeNull();
    expect(parseMobileAccessPort('7.5')).toBeNull();
  });

  it('keeps an assigned selection and otherwise prefers a phone-reachable interface', () => {
    expect(preferredMobileAccessAddress(interfaces, '100.90.1.2')).toBe('100.90.1.2');
    expect(preferredMobileAccessAddress(interfaces, null)).toBe('192.168.1.20');
    expect(preferredMobileAccessAddress(interfaces.slice(0, 1), null)).toBe('127.0.0.1');
    expect(preferredMobileAccessAddress([], null)).toBeNull();
  });

  it('uses concise runtime labels', () => {
    expect(mobileAccessStatusLabel('running')).toBe('Running');
    expect(mobileAccessStatusLabel('error')).toBe('Error');
  });
});
