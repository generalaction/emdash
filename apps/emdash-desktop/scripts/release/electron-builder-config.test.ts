import { describe, expect, it } from 'vitest';
import canaryConfig from '../../electron-builder.canary.config.ts';
import stableConfig from '../../electron-builder.config.ts';

const localNetworkUsageDescription =
  'Emdash needs local network access to connect to SSH hosts on your network.';

describe('macOS packaging permissions', () => {
  it('includes local network access in stable and canary bundles', () => {
    expect(stableConfig.mac?.extendInfo).toMatchObject({
      NSLocalNetworkUsageDescription: localNetworkUsageDescription,
    });
    expect(canaryConfig.mac?.extendInfo).toMatchObject({
      NSLocalNetworkUsageDescription: localNetworkUsageDescription,
    });
  });
});
