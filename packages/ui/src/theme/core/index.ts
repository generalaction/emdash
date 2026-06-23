/**
 * Public API barrel for the theme creation runtime library.
 *
 * Consumers should import from here rather than from individual internal modules.
 * The generate/ and codegen/ subdirectories are internal implementation details.
 */

export { defineTheme } from './define-theme';
export type { ThemeInput, ResolvedTheme, HueSeed } from './define-theme';

export type {
  ScaleName,
  HueScaleName,
  Polarity,
  Ramp,
  Scales,
  Surfaces,
  SurfaceLevel,
  SurfaceLevelName,
  SurfaceRoleName,
  SurfaceScopeName,
  SurfaceStatusName,
  SyntaxRole,
  Step,
} from './contract/roles';

export {
  SCALE_NAMES,
  STEPS,
  SURFACE_LEVELS,
  SURFACE_ROLES,
  SURFACE_SCOPES,
  SURFACE_STATUSES,
  STATUS_SCALE,
} from './contract/roles';

export { SEMANTIC_TEMPLATE, SEMANTIC_VARS } from './contract/semantic-template';
export type { SemanticSlot, SemanticVar } from './contract/semantic-template';
