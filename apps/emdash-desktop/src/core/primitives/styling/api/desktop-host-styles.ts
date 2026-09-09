/**
 * Stable desktop-owned marker for the active Host Styling Adapter root.
 *
 * The renderer bootstrap applies this marker to `document.documentElement`;
 * feature-owned Adapter modules root their host-layer output beneath it.
 */
export const DESKTOP_HOST_ROOT_ATTRIBUTE = 'data-emdash-desktop-host' as const;
export const DESKTOP_HOST_ROOT_SELECTOR = `[${DESKTOP_HOST_ROOT_ATTRIBUTE}]` as const;

export type DesktopHostRootMarker = Readonly<Record<typeof DESKTOP_HOST_ROOT_ATTRIBUTE, ''>>;

export const desktopHostRootMarker: DesktopHostRootMarker = {
  [DESKTOP_HOST_ROOT_ATTRIBUTE]: '',
};

/**
 * A feature-owned Host Styling Adapter export aggregated by the desktop
 * renderer entrypoint. Keeping the contribution typed and local avoids a
 * shared product-style barrel.
 */
export type DesktopHostStyleContribution<Exports extends object = object> = Readonly<{
  id: string;
  exports: Exports;
}>;

export function defineDesktopHostStyleContribution<
  const Contribution extends DesktopHostStyleContribution,
>(contribution: Contribution): Contribution {
  return contribution;
}
