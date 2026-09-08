/**
 * Focused fixture for Base UI's runtime geometry contract.
 *
 * Base UI writes these properties on generated popup/collapsible DOM. Emdash
 * can consume them but cannot rename the foreign runtime values.
 */
export const baseUiRuntimeValues = {
  popupAnchorWidth: 'var(--anchor-width)',
  popupAvailableHeight: 'var(--available-height)',
  popupAvailableWidth: 'var(--available-width)',
  popupTransformOrigin: 'var(--transform-origin)',
  collapsiblePanelHeight: 'var(--collapsible-panel-height)',
};
