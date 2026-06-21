import { createVar, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { sx } from '@styles/sprinkles.css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type FileOpStyleVars = {
  padY: number;
};

export const fileOpCardVars = createVariableThemeContract<FileOpStyleVars>({
  padY: null,
});

// Root height managed separately so inner list components can set padY independently.
export const fileOpHeightVar = createVar();
export const fileOpRoot = style({ height: fileOpHeightVar });

export const fileRow = recipe({
  base: sx({
    display: 'flex',
    alignItems: 'center',
    gap: '1.5',
    color: 'fgPassive',
    fontSize: 'sm',
  }),
  variants: {
    clickable: {
      true: {
        cursor: 'pointer',
        selectors: {
          '&:hover': { color: vars.fgMuted },
        },
      },
      false: {},
    },
  },
});

export const fileOpHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
  color: vars.fgPassive,
  fontSize: '0.875rem',
  userSelect: 'none',
  selectors: {
    '&:hover': { color: vars.fgMuted },
  },
});

export const monoRunning = style({
  fontFamily: 'monospace',
  fontSize: '0.875rem',
  color: vars.fgPassive,
});

/** Single-file op wrapper — flex row, full height. */
export const singleOpRow = style({
  display: 'flex',
  alignItems: 'center',
});

export const chevronSm = recipe({
  base: {
    display: 'inline-block',
    fontSize: '10px',
    transition: 'transform 150ms ease-out',
  },
  variants: {
    expanded: {
      true: { transform: 'rotate(90deg)' },
      false: {},
    },
  },
});
