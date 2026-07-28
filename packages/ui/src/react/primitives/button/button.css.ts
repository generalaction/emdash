import { globalStyle } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

// Kbd variables are set on the Button so any nested Kbd (via the `kbd` prop or
// children) inherits the appropriate background, border, and foreground for the
// button variant/tone. Kbd itself falls back to its neutral surface defaults.

globalStyle('[data-slot="button"][data-variant="primary"][data-tone="neutral"]', {
  vars: {
    '--kbd-bg': 'color-mix(in srgb, black 20%, transparent)',
    '--kbd-border': 'transparent',
    '--kbd-color': `color-mix(in srgb, ${vars.primaryButtonForeground} 70%, transparent)`,
  },
});

globalStyle('[data-slot="button"][data-variant="primary"][data-tone="destructive"]', {
  vars: {
    '--kbd-bg': vars.backgroundDestructive1,
    '--kbd-border': 'transparent',
    '--kbd-color': `color-mix(in srgb, ${vars.foregroundDestructive} 70%, transparent)`,
  },
});

globalStyle('[data-slot="button"][data-variant="secondary"]', {
  vars: {
    '--kbd-bg': vars.backgroundTertiary2,
    '--kbd-border': 'transparent',
    '--kbd-color': `color-mix(in srgb, ${vars.foregroundMuted} 70%, transparent)`,
  },
});

globalStyle('[data-slot="button"][data-variant="ghost"]', {
  vars: {
    '--kbd-bg': vars.backgroundTertiary2,
    '--kbd-border': 'transparent',
    '--kbd-color': `color-mix(in srgb, ${vars.foregroundMuted} 70%, transparent)`,
  },
});
