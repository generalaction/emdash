import type { PluginIconVariant } from '@agent/shared/plugins';

/** Pick the variant with the largest minSize that fits the rendered size. */
export function pickIconVariant(variants: PluginIconVariant[], size: number): PluginIconVariant {
  return (
    [...variants].sort((a, b) => b.minSize - a.minSize).find((v) => v.minSize <= size) ??
    variants[0]
  );
}
