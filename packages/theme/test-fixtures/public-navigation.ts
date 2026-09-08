import { SEMANTIC_TEMPLATE, tokens } from '@emdash/theme';
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

// @ts-expect-error Product diff meanings are owned by desktop feature Recipes.
SEMANTIC_TEMPLATE['foreground-diff-added'];
// @ts-expect-error Product workflow meanings are owned by desktop feature Recipes.
SEMANTIC_TEMPLATE['status-in-review'];
// @ts-expect-error Product VCS meanings are owned by desktop feature Recipes.
SEMANTIC_TEMPLATE['foreground-merged'];

const colorSchemeId: ColorSchemeId = COLOR_SCHEME_MANIFEST[0].id;
const densityId: DensityId = DENSITY_MANIFEST[0].id;
const typographyId: TypographyId = TYPOGRAPHY_MANIFEST[0].id;

void [paletteStep, surfaceLevel, typographySize, colorSchemeId, densityId, typographyId];
