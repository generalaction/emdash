import type z from 'zod';
import type { AssetDescriptors, AssetMap } from './asset';
import type { CapabilityBehaviors, CapabilityDescriptors, CapabilityMap } from './capability';

/**
 * Create a plugin framework bound to a fixed capability map, metadata schema,
 * and asset map.
 *
 * The capability and asset maps are passed as values so their precise types
 * are inferred, which makes the descriptor record, the asset record
 * (definePlugin), and the behavior record (registerPluginBehavior) exactly
 * typed per slot key.
 */
export function createPluginFramework<
  TCaps extends CapabilityMap,
  TMetaSchema extends z.ZodType,
  TAssets extends AssetMap,
>(capabilityMap: TCaps, metadataSchema: TMetaSchema, assetMap: TAssets) {
  type TMeta = z.output<TMetaSchema>;

  function definePlugin(
    metadata: TMeta,
    capabilities: CapabilityDescriptors<TCaps>,
    assets: AssetDescriptors<TAssets>
  ) {
    return {
      metadata,
      capabilities,
      assets,
      validate(): z.ZodError[] {
        const metaResult = metadataSchema.safeParse(metadata);
        if (!metaResult.success) return [metaResult.error];
        return [
          ...Object.entries(capabilityMap).flatMap(([key, cap]) => {
            const result = cap.descriptorSchema.safeParse(capabilities[key as keyof TCaps]);
            return result.success ? [] : [result.error];
          }),
          ...Object.entries(assetMap).flatMap(([key, asset]) => {
            const result = asset.assetSchema.safeParse(assets[key as keyof TAssets]);
            return result.success ? [] : [result.error];
          }),
        ];
      },
    };
  }

  type PluginDefinition = ReturnType<typeof definePlugin>;

  function registerPluginBehavior(plugin: PluginDefinition, behavior: CapabilityBehaviors<TCaps>) {
    return { ...plugin, behavior };
  }

  return { definePlugin, registerPluginBehavior };
}
