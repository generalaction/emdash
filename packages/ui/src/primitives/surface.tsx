/**
 * Surface — elevation scope component.
 *
 * Applies a surface scope class that CSS cascade picks up, so nested components
 * using bg-surface / bg-surface-emphasis automatically resolve to the right level.
 *
 * Usage:
 *   <Surface level="base">          sets .surface-base on the canvas
 *   <Surface level="elevated">      sets .surface-elevated on a dialog/tab
 *   <Surface emphasis>              sets .surface-emphasis on a card/tab strip
 *   <Surface emphasis level="...">  explicit emphasis that also re-scopes
 */

import React, { createContext, useContext } from 'react';
import { cn } from '../lib/cn';
import type { SurfaceLevelName, SurfaceStatusName } from '../theme/contract/roles';

// ── Context ───────────────────────────────────────────────────────────────────

const SurfaceContext = createContext<SurfaceLevelName>('base');

/** Returns the SurfaceLevelName of the nearest <Surface> ancestor. */
export function useSurfaceLevel(): SurfaceLevelName {
  return useContext(SurfaceContext);
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Explicit elevation level. Sets the `.surface-<level>` scope class on this element.
   * Omit entirely when using `emphasis` or `status` — the cascade handles the level.
   */
  level?: SurfaceLevelName;
  /**
   * When true, applies `.surface-emphasis`, which resolves to the next level
   * above the nearest canvas scope without requiring the caller to know the level.
   */
  emphasis?: boolean;
  /**
   * Status tint. Applies `.surface-<status>` which rebinds the generic
   * --surface-* cascade vars to the tinted status room. A ghost Button/Toggle/Tab
   * inside a status surface will automatically use tinted hover/selected states.
   * Can be combined with `level` to set both the elevation and the status tint.
   */
  status?: SurfaceStatusName;
  /** Element to render. Defaults to div. */
  as?: React.ElementType;
}

export function Surface({
  level,
  emphasis,
  status,
  as: As = 'div',
  className,
  children,
  ...props
}: SurfaceProps) {
  const elevationClass = emphasis ? 'surface-emphasis' : level ? `surface-${level}` : undefined;
  const statusClass = status ? `surface-${status}` : undefined;

  // Resolve the context value so JS consumers of useSurfaceLevel() get the
  // correct level. When using emphasis or status, we propagate the parent level
  // unchanged (the CSS cascade handles the visual shift; React context is for JS use only).
  const parentLevel = useContext(SurfaceContext);
  const contextValue: SurfaceLevelName = level ?? parentLevel;

  return (
    <SurfaceContext.Provider value={contextValue}>
      <As className={cn(elevationClass, statusClass, className)} {...props}>
        {children}
      </As>
    </SurfaceContext.Provider>
  );
}
