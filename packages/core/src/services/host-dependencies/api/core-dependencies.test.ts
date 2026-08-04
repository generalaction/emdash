import { hostDependencyDefinitionSchema } from '@primitives/host-dependencies/api';
import { describe, expect, it } from 'vitest';
import {
  CORE_DEPENDENCIES,
  GIT_DEPENDENCY_DESCRIPTOR,
  RECOMMENDED_CORE_DEPENDENCIES,
  REQUIRED_CORE_DEPENDENCIES,
} from './core-dependencies';

describe('CORE_DEPENDENCIES', () => {
  it('keeps every core dependency in exactly one classification set', () => {
    const requiredIds = new Set(REQUIRED_CORE_DEPENDENCIES.map((dependency) => dependency.id));
    const recommendedIds = new Set(
      RECOMMENDED_CORE_DEPENDENCIES.map((dependency) => dependency.id)
    );

    for (const dependency of REQUIRED_CORE_DEPENDENCIES) {
      expect(recommendedIds.has(dependency.id)).toBe(false);
    }
    for (const dependency of RECOMMENDED_CORE_DEPENDENCIES) {
      expect(requiredIds.has(dependency.id)).toBe(false);
    }
    expect(new Set(CORE_DEPENDENCIES.map((dependency) => dependency.id))).toEqual(
      new Set([...requiredIds, ...recommendedIds])
    );
  });

  it('defines valid host dependency descriptors for all system dependencies', () => {
    expect(() =>
      CORE_DEPENDENCIES.map((dependency) => hostDependencyDefinitionSchema.parse(dependency))
    ).not.toThrow();
  });

  it('marks linux apt install options as requiring elevation with a sudo-only command', () => {
    for (const dependency of CORE_DEPENDENCIES) {
      const linuxOptions = dependency.installCommands?.linux ?? [];
      for (const option of linuxOptions) {
        if (option.method !== 'apt') continue;
        expect(option.requiresElevation).toBe(true);
        expect(option.command).toMatch(/^sudo apt-get update && sudo apt-get install -y /);
        expect(option.command).not.toContain('command -v sudo');
      }
    }
  });

  it('uses sudo apt-get for git on linux', () => {
    expect(GIT_DEPENDENCY_DESCRIPTOR.installCommands?.linux).toEqual([
      {
        method: 'apt',
        command: 'sudo apt-get update && sudo apt-get install -y git',
        recommended: true,
        requiresElevation: true,
      },
    ]);
  });
});
