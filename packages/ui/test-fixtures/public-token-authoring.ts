import { tokens } from '@emdash/theme';
import { style, sx } from '@emdash/ui/styles';

const sharedRecipeClass = style({
  color: tokens.foreground.default,
  fontFamily: tokens.typography.family.sans,
  fontSize: tokens.typography.size.sm,
  borderColor: tokens.surface.tone.warning.level.sunken.border,
});

const utilityClass = sx({
  gap: tokens.space.step2,
  rounded: tokens.radius.md,
  color: tokens.surface.tone.destructive.level.sunken.foreground,
  background: tokens.surface.tone.info.role.paper.background,
});

// @ts-expect-error The literal Theme declaration has no arbitrary Surface level.
tokens.surface.tone.destructive.level.flat;
// @ts-expect-error The finite sx vocabulary rejects raw custom-property strings.
sx({ gap: 'var(--em-space-custom)' });

void [sharedRecipeClass, utilityClass];
