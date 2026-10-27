import type { Configuration } from 'electron-builder';

export function createReleaseBuildConfig(
  baseConfig: Configuration,
  electronVersion: string,
  versionOverride?: string
): Configuration {
  // electron-builder mutates config.files while normalizing it. Each architecture
  // needs its own copy, including nested metadata and platform configuration.
  const config = structuredClone(baseConfig);
  return {
    ...config,
    electronVersion,
    npmRebuild: false,
    ...(versionOverride === undefined
      ? {}
      : { extraMetadata: { ...config.extraMetadata, version: versionOverride } }),
  };
}
