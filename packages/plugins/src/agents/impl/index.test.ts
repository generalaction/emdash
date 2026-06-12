import { describe, expect, it } from 'vitest';
import { pluginRegistry } from '../registry';

describe('pluginRegistry', () => {
  it('each entry has required string fields', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(typeof d.metadata.id).toBe('string');
      expect(d.metadata.id.length).toBeGreaterThan(0);
      expect(typeof d.metadata.name).toBe('string');
      expect(typeof d.metadata.description).toBe('string');
      expect(typeof d.metadata.websiteUrl).toBe('string');
    }
  });

  it('each entry passes validate() with no errors', () => {
    for (const d of pluginRegistry.getAll()) {
      const errors = d.validate();
      expect(errors, `${d.metadata.id} validate() errors: ${JSON.stringify(errors)}`).toHaveLength(
        0
      );
    }
  });

  it('capabilities contain no function values at top level', () => {
    for (const d of pluginRegistry.getAll()) {
      for (const v of Object.values(d.capabilities as Record<string, unknown>)) {
        expect(typeof v).not.toBe('function');
      }
    }
  });

  it('each entry has required capabilities', () => {
    for (const d of pluginRegistry.getAll()) {
      const { capabilities } = d;
      expect(capabilities.hostDependency).toBeDefined();
      expect(capabilities.hooks).toBeDefined();
      expect(capabilities.mcp).toBeDefined();
      expect(capabilities.plugins).toBeDefined();
      expect(['supported', 'none']).toContain(capabilities.autoApprove.kind);
      expect(['resumable', 'stateless']).toContain(capabilities.sessions.kind);
    }
  });

  it('each entry has hostDependency.updates with valid kind', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.capabilities.hostDependency.updates).toBeDefined();
      expect(['supported', 'none']).toContain(d.capabilities.hostDependency.updates.kind);
    }
  });

  it('supported updates have valid releaseSource and update strategy', () => {
    for (const d of pluginRegistry.getAll()) {
      if (d.capabilities.hostDependency.updates.kind !== 'supported') continue;
      const { releaseSource, update } = d.capabilities.hostDependency.updates;
      expect(['npm', 'github', 'none']).toContain(releaseSource.kind);
      expect(['package-manager', 'cli', 'auto', 'none']).toContain(update.kind);
    }
  });

  it('all binaryNames are non-empty strings', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.capabilities.hostDependency.binaryNames.length).toBeGreaterThan(0);
      for (const bin of d.capabilities.hostDependency.binaryNames) {
        expect(typeof bin).toBe('string');
        expect(bin.length).toBeGreaterThan(0);
      }
    }
  });

  it('each defined platform installCommands entry is a non-empty array of valid InstallOptions', () => {
    const validMethods = [
      'installer-macos',
      'installer-windows',
      'installer-linux',
      'homebrew',
      'winget',
      'powershell',
      'npm',
      'apt',
      'curl',
      'pip',
      'cargo',
      'other',
    ];
    for (const d of pluginRegistry.getAll()) {
      const { installCommands } = d.capabilities.hostDependency;
      for (const [platform, options] of Object.entries(installCommands)) {
        expect(Array.isArray(options), `${d.metadata.id}.${platform} should be an array`).toBe(
          true
        );
        expect(
          options!.length,
          `${d.metadata.id}.${platform} array should be non-empty`
        ).toBeGreaterThan(0);
        for (const opt of options!) {
          expect(
            typeof opt.command,
            `${d.metadata.id}.${platform} command should be a string`
          ).toBe('string');
          expect(
            opt.command.length,
            `${d.metadata.id}.${platform} command should be non-empty`
          ).toBeGreaterThan(0);
          expect(validMethods, `${d.metadata.id}.${platform} method should be valid`).toContain(
            opt.method
          );
        }
      }
    }
  });

  it('each entry has an icon asset with at least one variant', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.assets.icon).toBeDefined();
      expect(d.assets.icon.variants.length).toBeGreaterThan(0);
      for (const v of d.assets.icon.variants) {
        expect(typeof v.light).toBe('string');
        expect(v.light.length).toBeGreaterThan(0);
      }
    }
  });

  it('each entry has a behavior.prompt.buildCommand function', () => {
    for (const p of pluginRegistry.getAll()) {
      expect(typeof p.behavior.prompt?.buildCommand).toBe('function');
    }
  });
});
