import { describe, expect, it } from 'vitest';
import {
  isMac,
  isWindows,
  isLinux,
  PLATFORM_MAC,
  PLATFORM_WINDOWS,
  PLATFORM_LINUX,
} from './platform';

describe('isMac', () => {
  it('returns true for darwin platform', () => {
    expect(isMac('darwin')).toBe(true);
    expect(isMac(PLATFORM_MAC)).toBe(true);
  });

  it('returns false for other platforms', () => {
    expect(isMac('win32')).toBe(false);
    expect(isMac(PLATFORM_WINDOWS)).toBe(false);
    expect(isMac('linux')).toBe(false);
    expect(isMac(PLATFORM_LINUX)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMac(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMac('')).toBe(false);
  });

  it('returns false for invalid platform strings', () => {
    expect(isMac('freebsd')).toBe(false);
    expect(isMac('aix')).toBe(false);
    expect(isMac('android')).toBe(false);
  });
});

describe('isWindows', () => {
  it('returns true for win32 platform', () => {
    expect(isWindows('win32')).toBe(true);
    expect(isWindows(PLATFORM_WINDOWS)).toBe(true);
  });

  it('returns false for other platforms', () => {
    expect(isWindows('darwin')).toBe(false);
    expect(isWindows(PLATFORM_MAC)).toBe(false);
    expect(isWindows('linux')).toBe(false);
    expect(isWindows(PLATFORM_LINUX)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isWindows(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isWindows('')).toBe(false);
  });

  it('returns false for invalid platform strings', () => {
    expect(isWindows('freebsd')).toBe(false);
    expect(isWindows('aix')).toBe(false);
    expect(isWindows('android')).toBe(false);
  });
});

describe('isLinux', () => {
  it('returns true for linux platform', () => {
    expect(isLinux('linux')).toBe(true);
    expect(isLinux(PLATFORM_LINUX)).toBe(true);
  });

  it('returns false for other platforms', () => {
    expect(isLinux('darwin')).toBe(false);
    expect(isLinux(PLATFORM_MAC)).toBe(false);
    expect(isLinux('win32')).toBe(false);
    expect(isLinux(PLATFORM_WINDOWS)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isLinux(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLinux('')).toBe(false);
  });

  it('returns false for invalid platform strings', () => {
    expect(isLinux('freebsd')).toBe(false);
    expect(isLinux('aix')).toBe(false);
    expect(isLinux('android')).toBe(false);
  });
});
