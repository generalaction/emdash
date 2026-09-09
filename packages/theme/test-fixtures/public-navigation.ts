import {
  tokens,
  type SurfaceLevelName,
  type SurfaceRoleName,
  type SurfaceScopeName,
  type SurfaceToneName,
  type TokenReference,
} from '@emdash/theme';
import {
  COLOR_SCHEME_MANIFEST,
  DENSITY_MANIFEST,
  TYPOGRAPHY_MANIFEST,
  type ColorSchemeId,
  type DensityId,
  type TypographyId,
} from '@emdash/theme/profiles';

const paletteStep: 'var(--em-neutral-1)' = tokens.palette.neutral.step1;
const surfaceLevel: 'var(--em-surface-raised)' = tokens.surface.level.raised.background;
const typographySize: 'var(--em-text-2xl)' = tokens.typography.size.twoXl;
const tokenReference: TokenReference = tokens.foreground.default;
const levelName: SurfaceLevelName = 'raised';
const roleName: SurfaceRoleName = 'paper';
const scopeName: SurfaceScopeName = roleName;
const toneName: SurfaceToneName = 'warning';

// @ts-expect-error Product meanings are owned by host feature Recipes.
tokens.foreground.diffAdded;

const colorSchemeId: ColorSchemeId = COLOR_SCHEME_MANIFEST[0].id;
const densityId: DensityId = DENSITY_MANIFEST[0].id;
const typographyId: TypographyId = TYPOGRAPHY_MANIFEST[0].id;

void [
  paletteStep,
  surfaceLevel,
  typographySize,
  tokenReference,
  levelName,
  roleName,
  scopeName,
  toneName,
  colorSchemeId,
  densityId,
  typographyId,
];
