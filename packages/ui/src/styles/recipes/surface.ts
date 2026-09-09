import type { SurfaceLevelName, SurfaceRoleName, SurfaceToneName } from '@emdash/theme';
import { surfaceRecipe } from './surface.css';

export interface SurfaceAxes {
  level?: SurfaceLevelName;
  role?: SurfaceRoleName;
  tone?: SurfaceToneName;
  emphasis?: boolean;
}

export type SurfaceOptions = SurfaceAxes &
  (
    | { level: SurfaceLevelName }
    | { role: SurfaceRoleName }
    | { tone: SurfaceToneName }
    | { emphasis: true }
  );

/**
 * Establishes and paints one Surface context.
 *
 * At least one Level, Role, Tone, or context-relative emphasis axis is
 * required. Omitted axes inherit from the surrounding Surface.
 *
 * @example
 * ```tsx
 * <section className={surface({ level: 'base' })}>
 *   <aside className={surface({ emphasis: true })}>Context-relative content</aside>
 * </section>
 * ```
 */
export function surface(options: SurfaceOptions): string {
  if (
    options == null ||
    (options.level == null &&
      options.role == null &&
      options.tone == null &&
      options.emphasis !== true)
  ) {
    throw new Error('surface() requires level, role, tone, or emphasis');
  }

  return surfaceRecipe(options);
}
