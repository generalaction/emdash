/**
 * Focused fixture for Sonner's public theme-property contract.
 *
 * Sonner reads these exact foreign properties from its generated toaster DOM,
 * so host styling must write the names defined by the library.
 */
export const sonnerThemeValues = {
  '--normal-bg': 'var(--em-surface)',
  '--normal-border': 'var(--em-border-default)',
  '--normal-text': 'var(--em-foreground)',
  '--border-radius': 'var(--em-radius-lg)',
};
