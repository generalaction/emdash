/**
 * Public authoring API for canonical Theme Token References.
 *
 * Profile metadata and runtime resolution have dedicated public subpaths.
 * Theme generation, compilation, and contract data are package internals.
 */

import { tokens } from './tokens';

export { tokens };
export type { TokenReference } from './tokens';

export type SurfaceLevelName = keyof typeof tokens.surface.level;
export type SurfaceRoleName = keyof typeof tokens.surface.role;
export type SurfaceScopeName = SurfaceLevelName | SurfaceRoleName;
export type SurfaceToneName = keyof typeof tokens.surface.tone;
