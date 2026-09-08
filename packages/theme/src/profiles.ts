import { DENSITY_MANIFEST as DENSITY_PROFILE_MANIFEST } from './densities/registry';
import type { DensityId as SupportedDensityId } from './densities/registry';
import { THEME_MANIFEST } from './themes/registry';
import { ALL_TYPOGRAPHIES } from './typographies/registry';

/** Runtime manifest for independently selectable Color scheme profiles. */
export const COLOR_SCHEME_MANIFEST = THEME_MANIFEST;

/** Runtime manifest for independently selectable Density profiles. */
export const DENSITY_MANIFEST = DENSITY_PROFILE_MANIFEST;

/** Runtime manifest for independently selectable Typography profiles. */
export const TYPOGRAPHY_MANIFEST = ALL_TYPOGRAPHIES.map(({ id, label, selector }) => ({
  id,
  label,
  selector,
}));

export const PROFILE_MANIFESTS = {
  colorSchemes: COLOR_SCHEME_MANIFEST,
  densities: DENSITY_MANIFEST,
  typographies: TYPOGRAPHY_MANIFEST,
} as const;

export type ColorSchemeId = (typeof COLOR_SCHEME_MANIFEST)[number]['id'];
export type DensityId = SupportedDensityId;
export type TypographyId = (typeof TYPOGRAPHY_MANIFEST)[number]['id'];

export type ColorSchemeManifestEntry = (typeof COLOR_SCHEME_MANIFEST)[number];
export type DensityManifestEntry = (typeof DENSITY_MANIFEST)[number];
export type TypographyManifestEntry = (typeof TYPOGRAPHY_MANIFEST)[number];
