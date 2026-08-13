import { workbenchPaletteProviderDefs } from '@core/features/workbench/contributions/browser/legacy-palette-provider';
import { definePaletteProviderCatalog } from '@core/primitives/palette/api';

export const PALETTE_PROVIDER_CATALOG = definePaletteProviderCatalog([
  ...workbenchPaletteProviderDefs,
] as const);
