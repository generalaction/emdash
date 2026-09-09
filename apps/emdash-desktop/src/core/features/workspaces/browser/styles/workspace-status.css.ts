import { tokens } from '@emdash/theme';
import { hostRecipe } from '@emdash/ui/styles/host';
import { DESKTOP_HOST_ROOT_SELECTOR } from '@core/primitives/styling/api/desktop-host-styles';

export const workspaceRuntimeStatus = hostRecipe({
  base: {
    selectors: {
      [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
        borderWidth: '1px',
        borderStyle: 'solid',
        borderRadius: tokens.radius.full,
        padding: `${tokens.space.step0_5} ${tokens.space.step2}`,
        fontSize: tokens.typography.size.tiny,
        letterSpacing: '0.025em',
        textTransform: 'uppercase',
      },
    },
  },
  variants: {
    status: {
      active: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.success.foreground,
            borderColor: tokens.feedback.success.border,
          },
        },
      },
      'setting-up': {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.info.foreground,
            borderColor: tokens.feedback.info.border,
          },
        },
      },
      'tearing-down': {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.warning.foreground,
            borderColor: tokens.feedback.warning.border,
          },
        },
      },
      error: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.surface.tone.destructive.foreground,
            borderColor: tokens.border.destructive,
          },
        },
      },
      idle: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
            borderColor: tokens.border.default,
          },
        },
      },
    },
  },
});

export const workspaceScanWarning = hostRecipe({
  variants: {
    tone: {
      warning: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: tokens.space.step2,
            marginTop: tokens.space.step3,
            padding: `${tokens.space.step2} ${tokens.space.step3}`,
            color: tokens.feedback.warning.foreground,
            fontSize: tokens.typography.size.xs,
            backgroundColor: tokens.feedback.warning.background,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: tokens.feedback.warning.border,
            borderRadius: tokens.radius.md,
          },
        },
      },
    },
  },
});

export const workspaceScanWarningDetail = hostRecipe({
  variants: {
    tone: {
      warning: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.warning.foreground,
            opacity: 0.8,
          },
        },
      },
    },
  },
});
