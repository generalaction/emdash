import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';

const statusDotColor = '--_workspace-status-dot-color';

export const workspaceIcon = recipe({
  base: {
    position: 'relative',
    display: 'inline-flex',
    width: 'var(--_workspace-icon-size, 2.25rem)',
    height: 'var(--_workspace-icon-size, 2.25rem)',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface.current.emphasis,
    color: tokens.foreground.muted,
    transition: 'background-color 100ms',
    vars: {
      [iconSizeVar]: 'calc(var(--_workspace-icon-size, 2.25rem) * 0.4444)',
    },
    selectors: {
      // Step up with the host row's hover so tile/row contrast is preserved:
      // the row paints surfaceHover while the tile paints surfaceEmphasisHover.
      "[data-slot='list-row']:hover &": {
        backgroundColor: tokens.surface.current.emphasisHover,
      },
    },
  },
  variants: {
    status: {
      active: {
        vars: { [statusDotColor]: tokens.feedback.success.foreground },
      },
      idle: {
        vars: { [statusDotColor]: tokens.foreground.muted },
      },
      'setting-up': {
        vars: { [statusDotColor]: tokens.feedback.info.foreground },
      },
      // Warning foreground is intentionally dark in light themes, so use the
      // bright amber palette step for this compact status mark.
      'tearing-down': {
        vars: { [statusDotColor]: tokens.palette.amber.step9 },
      },
      error: {
        vars: { [statusDotColor]: tokens.feedback.error.foreground },
      },
    },
  },
});

export const statusDot = style({
  position: 'absolute',
  right: '-0.125rem',
  bottom: '-0.125rem',
  // 0.625rem at the default 2.25rem tile size, scaling with the size prop.
  width: 'calc(var(--_workspace-icon-size, 2.25rem) * 0.2778)',
  height: 'calc(var(--_workspace-icon-size, 2.25rem) * 0.2778)',
  borderRadius: '50%',
  backgroundColor: `var(${statusDotColor})`,
  // Ring separating the dot from the tile and the surface behind it.
  boxShadow: `0 0 0 2px ${tokens.surface.current.background}`,
  transition: 'box-shadow 100ms',
  selectors: {
    // Keep the ring matched to the hovered row background.
    "[data-slot='list-row']:hover &": {
      boxShadow: `0 0 0 2px ${tokens.surface.current.hover}`,
    },
  },
});
