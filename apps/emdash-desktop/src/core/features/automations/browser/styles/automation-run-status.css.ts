import { tokens } from '@emdash/theme';
import { hostRecipe } from '@emdash/ui/styles/host';
import { DESKTOP_HOST_ROOT_SELECTOR } from '@core/primitives/styling/api/desktop-host-styles';

const rootedColor = (color: string) => ({
  selectors: {
    [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
      color,
    },
  },
});

/** Automation workflow states as icon-only product semantics. */
export const automationRunIcon = hostRecipe({
  variants: {
    status: {
      scheduled: rootedColor(tokens.feedback.info.foreground),
      queued: rootedColor(tokens.foreground.muted),
      provisioning_workspace: rootedColor(tokens.foreground.muted),
      starting_session: rootedColor(tokens.foreground.muted),
      done: rootedColor(tokens.feedback.success.foreground),
      failed: rootedColor(tokens.feedback.error.foreground),
      skipped: rootedColor(tokens.foreground.muted),
      cancelled: rootedColor(tokens.foreground.muted),
      unavailable: rootedColor(tokens.feedback.warning.foreground),
    },
  },
});

/** Complete badge presentation for automation workflow states. */
export const automationRunBadge = hostRecipe({
  base: {
    selectors: {
      [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
        display: 'flex',
        flexShrink: 0,
        alignItems: 'center',
        gap: tokens.space.step1,
        borderRadius: tokens.radius.md,
        padding: `${tokens.space.step0_5} ${tokens.space.step1_5}`,
        fontSize: tokens.typography.size.xs,
      },
    },
  },
  variants: {
    status: {
      queued: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.info.foreground,
            backgroundColor: tokens.feedback.info.background,
          },
        },
      },
      provisioning_workspace: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
            backgroundColor: tokens.palette.neutral.step4,
          },
        },
      },
      starting_session: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
            backgroundColor: tokens.palette.neutral.step4,
          },
        },
      },
      done: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.success.foreground,
            backgroundColor: tokens.feedback.success.background,
          },
        },
      },
      failed: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.error.foreground,
            backgroundColor: tokens.feedback.error.background,
          },
        },
      },
      skipped: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
            backgroundColor: tokens.palette.neutral.step4,
          },
        },
      },
      cancelled: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
            backgroundColor: tokens.palette.neutral.step4,
          },
        },
      },
    },
  },
});
