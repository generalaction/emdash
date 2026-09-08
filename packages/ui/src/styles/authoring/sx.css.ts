import { tokens } from '@emdash/theme';
import { createSprinkles, defineProperties } from '@vanilla-extract/sprinkles';
import { layerNames } from './layers.css';

const spaceTokens = [
  tokens.space.step0,
  tokens.space.step0_5,
  tokens.space.step1,
  tokens.space.step1_5,
  tokens.space.step2,
  tokens.space.step2_5,
  tokens.space.step3,
  tokens.space.step3_5,
  tokens.space.step4,
  tokens.space.step5,
  tokens.space.step6,
  tokens.space.step7,
  tokens.space.step8,
  tokens.space.step10,
  tokens.space.step12,
] as const;

const radiusTokens = [
  tokens.radius.default,
  tokens.radius.xs,
  tokens.radius.sm,
  tokens.radius.md,
  tokens.radius.lg,
  tokens.radius.xl,
  tokens.radius.twoXl,
  tokens.radius.full,
] as const;

const colorTokens = [
  tokens.palette.neutral.step1,
  tokens.palette.neutral.step2,
  tokens.palette.neutral.step3,
  tokens.palette.neutral.step4,
  tokens.palette.neutral.step5,
  tokens.palette.neutral.step6,
  tokens.palette.neutral.step7,
  tokens.palette.neutral.step8,
  tokens.palette.neutral.step9,
  tokens.palette.neutral.step10,
  tokens.palette.neutral.step11,
  tokens.palette.neutral.step12,
  tokens.palette.neutral.contrast,
  tokens.palette.accent.step1,
  tokens.palette.accent.step2,
  tokens.palette.accent.step3,
  tokens.palette.accent.step4,
  tokens.palette.accent.step5,
  tokens.palette.accent.step6,
  tokens.palette.accent.step7,
  tokens.palette.accent.step8,
  tokens.palette.accent.step9,
  tokens.palette.accent.step10,
  tokens.palette.accent.step11,
  tokens.palette.accent.step12,
  tokens.palette.accent.contrast,
  tokens.palette.green.step1,
  tokens.palette.green.step2,
  tokens.palette.green.step3,
  tokens.palette.green.step4,
  tokens.palette.green.step5,
  tokens.palette.green.step6,
  tokens.palette.green.step7,
  tokens.palette.green.step8,
  tokens.palette.green.step9,
  tokens.palette.green.step10,
  tokens.palette.green.step11,
  tokens.palette.green.step12,
  tokens.palette.green.contrast,
  tokens.palette.red.step1,
  tokens.palette.red.step2,
  tokens.palette.red.step3,
  tokens.palette.red.step4,
  tokens.palette.red.step5,
  tokens.palette.red.step6,
  tokens.palette.red.step7,
  tokens.palette.red.step8,
  tokens.palette.red.step9,
  tokens.palette.red.step10,
  tokens.palette.red.step11,
  tokens.palette.red.step12,
  tokens.palette.red.contrast,
  tokens.palette.amber.step1,
  tokens.palette.amber.step2,
  tokens.palette.amber.step3,
  tokens.palette.amber.step4,
  tokens.palette.amber.step5,
  tokens.palette.amber.step6,
  tokens.palette.amber.step7,
  tokens.palette.amber.step8,
  tokens.palette.amber.step9,
  tokens.palette.amber.step10,
  tokens.palette.amber.step11,
  tokens.palette.amber.step12,
  tokens.palette.amber.contrast,
  tokens.palette.blue.step1,
  tokens.palette.blue.step2,
  tokens.palette.blue.step3,
  tokens.palette.blue.step4,
  tokens.palette.blue.step5,
  tokens.palette.blue.step6,
  tokens.palette.blue.step7,
  tokens.palette.blue.step8,
  tokens.palette.blue.step9,
  tokens.palette.blue.step10,
  tokens.palette.blue.step11,
  tokens.palette.blue.step12,
  tokens.palette.blue.contrast,
  tokens.palette.orange.step1,
  tokens.palette.orange.step2,
  tokens.palette.orange.step3,
  tokens.palette.orange.step4,
  tokens.palette.orange.step5,
  tokens.palette.orange.step6,
  tokens.palette.orange.step7,
  tokens.palette.orange.step8,
  tokens.palette.orange.step9,
  tokens.palette.orange.step10,
  tokens.palette.orange.step11,
  tokens.palette.orange.step12,
  tokens.palette.orange.contrast,
  tokens.palette.purple.step1,
  tokens.palette.purple.step2,
  tokens.palette.purple.step3,
  tokens.palette.purple.step4,
  tokens.palette.purple.step5,
  tokens.palette.purple.step6,
  tokens.palette.purple.step7,
  tokens.palette.purple.step8,
  tokens.palette.purple.step9,
  tokens.palette.purple.step10,
  tokens.palette.purple.step11,
  tokens.palette.purple.step12,
  tokens.palette.purple.contrast,
  tokens.foreground.default,
  tokens.foreground.inverse,
  tokens.foreground.body,
  tokens.foreground.muted,
  tokens.foreground.passive,
  tokens.border.default,
  tokens.border.subtle,
  tokens.border.muted,
  tokens.border.strong,
  tokens.border.focus,
  tokens.border.destructive,
  tokens.surface.current.background,
  tokens.surface.current.hover,
  tokens.surface.current.selected,
  tokens.surface.current.emphasis,
  tokens.surface.current.emphasisHover,
  tokens.surface.current.emphasisSelected,
  tokens.surface.current.input,
  tokens.surface.current.border,
  tokens.surface.current.foreground,
  tokens.surface.level.sunken.background,
  tokens.surface.level.sunken.hover,
  tokens.surface.level.sunken.selected,
  tokens.surface.level.base.background,
  tokens.surface.level.base.hover,
  tokens.surface.level.base.selected,
  tokens.surface.level.raised.background,
  tokens.surface.level.raised.hover,
  tokens.surface.level.raised.selected,
  tokens.surface.level.elevated.background,
  tokens.surface.level.elevated.hover,
  tokens.surface.level.elevated.selected,
  tokens.surface.level.overlay.background,
  tokens.surface.level.overlay.hover,
  tokens.surface.level.overlay.selected,
  tokens.surface.role.paper.background,
  tokens.surface.role.paper.hover,
  tokens.surface.role.paper.selected,
  tokens.surface.tone.destructive.background,
  tokens.surface.tone.destructive.hover,
  tokens.surface.tone.destructive.selected,
  tokens.surface.tone.destructive.border,
  tokens.surface.tone.destructive.foreground,
  tokens.surface.tone.destructive.level.sunken.background,
  tokens.surface.tone.destructive.level.sunken.hover,
  tokens.surface.tone.destructive.level.sunken.selected,
  tokens.surface.tone.destructive.level.sunken.border,
  tokens.surface.tone.destructive.level.sunken.foreground,
  tokens.surface.tone.destructive.level.raised.background,
  tokens.surface.tone.destructive.level.raised.hover,
  tokens.surface.tone.destructive.level.raised.selected,
  tokens.surface.tone.destructive.level.raised.border,
  tokens.surface.tone.destructive.level.raised.foreground,
  tokens.surface.tone.destructive.level.elevated.background,
  tokens.surface.tone.destructive.level.elevated.hover,
  tokens.surface.tone.destructive.level.elevated.selected,
  tokens.surface.tone.destructive.level.elevated.border,
  tokens.surface.tone.destructive.level.elevated.foreground,
  tokens.surface.tone.destructive.level.overlay.background,
  tokens.surface.tone.destructive.level.overlay.hover,
  tokens.surface.tone.destructive.level.overlay.selected,
  tokens.surface.tone.destructive.level.overlay.border,
  tokens.surface.tone.destructive.level.overlay.foreground,
  tokens.surface.tone.destructive.role.paper.background,
  tokens.surface.tone.destructive.role.paper.hover,
  tokens.surface.tone.destructive.role.paper.selected,
  tokens.surface.tone.destructive.role.paper.border,
  tokens.surface.tone.destructive.role.paper.foreground,
  tokens.surface.tone.warning.background,
  tokens.surface.tone.warning.hover,
  tokens.surface.tone.warning.selected,
  tokens.surface.tone.warning.border,
  tokens.surface.tone.warning.foreground,
  tokens.surface.tone.warning.level.sunken.background,
  tokens.surface.tone.warning.level.sunken.hover,
  tokens.surface.tone.warning.level.sunken.selected,
  tokens.surface.tone.warning.level.sunken.border,
  tokens.surface.tone.warning.level.sunken.foreground,
  tokens.surface.tone.warning.level.raised.background,
  tokens.surface.tone.warning.level.raised.hover,
  tokens.surface.tone.warning.level.raised.selected,
  tokens.surface.tone.warning.level.raised.border,
  tokens.surface.tone.warning.level.raised.foreground,
  tokens.surface.tone.warning.level.elevated.background,
  tokens.surface.tone.warning.level.elevated.hover,
  tokens.surface.tone.warning.level.elevated.selected,
  tokens.surface.tone.warning.level.elevated.border,
  tokens.surface.tone.warning.level.elevated.foreground,
  tokens.surface.tone.warning.level.overlay.background,
  tokens.surface.tone.warning.level.overlay.hover,
  tokens.surface.tone.warning.level.overlay.selected,
  tokens.surface.tone.warning.level.overlay.border,
  tokens.surface.tone.warning.level.overlay.foreground,
  tokens.surface.tone.warning.role.paper.background,
  tokens.surface.tone.warning.role.paper.hover,
  tokens.surface.tone.warning.role.paper.selected,
  tokens.surface.tone.warning.role.paper.border,
  tokens.surface.tone.warning.role.paper.foreground,
  tokens.surface.tone.info.background,
  tokens.surface.tone.info.hover,
  tokens.surface.tone.info.selected,
  tokens.surface.tone.info.border,
  tokens.surface.tone.info.foreground,
  tokens.surface.tone.info.level.sunken.background,
  tokens.surface.tone.info.level.sunken.hover,
  tokens.surface.tone.info.level.sunken.selected,
  tokens.surface.tone.info.level.sunken.border,
  tokens.surface.tone.info.level.sunken.foreground,
  tokens.surface.tone.info.level.raised.background,
  tokens.surface.tone.info.level.raised.hover,
  tokens.surface.tone.info.level.raised.selected,
  tokens.surface.tone.info.level.raised.border,
  tokens.surface.tone.info.level.raised.foreground,
  tokens.surface.tone.info.level.elevated.background,
  tokens.surface.tone.info.level.elevated.hover,
  tokens.surface.tone.info.level.elevated.selected,
  tokens.surface.tone.info.level.elevated.border,
  tokens.surface.tone.info.level.elevated.foreground,
  tokens.surface.tone.info.level.overlay.background,
  tokens.surface.tone.info.level.overlay.hover,
  tokens.surface.tone.info.level.overlay.selected,
  tokens.surface.tone.info.level.overlay.border,
  tokens.surface.tone.info.level.overlay.foreground,
  tokens.surface.tone.info.role.paper.background,
  tokens.surface.tone.info.role.paper.hover,
  tokens.surface.tone.info.role.paper.selected,
  tokens.surface.tone.info.role.paper.border,
  tokens.surface.tone.info.role.paper.foreground,
  tokens.surface.tone.success.background,
  tokens.surface.tone.success.hover,
  tokens.surface.tone.success.selected,
  tokens.surface.tone.success.border,
  tokens.surface.tone.success.foreground,
  tokens.surface.tone.success.level.sunken.background,
  tokens.surface.tone.success.level.sunken.hover,
  tokens.surface.tone.success.level.sunken.selected,
  tokens.surface.tone.success.level.sunken.border,
  tokens.surface.tone.success.level.sunken.foreground,
  tokens.surface.tone.success.level.raised.background,
  tokens.surface.tone.success.level.raised.hover,
  tokens.surface.tone.success.level.raised.selected,
  tokens.surface.tone.success.level.raised.border,
  tokens.surface.tone.success.level.raised.foreground,
  tokens.surface.tone.success.level.elevated.background,
  tokens.surface.tone.success.level.elevated.hover,
  tokens.surface.tone.success.level.elevated.selected,
  tokens.surface.tone.success.level.elevated.border,
  tokens.surface.tone.success.level.elevated.foreground,
  tokens.surface.tone.success.level.overlay.background,
  tokens.surface.tone.success.level.overlay.hover,
  tokens.surface.tone.success.level.overlay.selected,
  tokens.surface.tone.success.level.overlay.border,
  tokens.surface.tone.success.level.overlay.foreground,
  tokens.surface.tone.success.role.paper.background,
  tokens.surface.tone.success.role.paper.hover,
  tokens.surface.tone.success.role.paper.selected,
  tokens.surface.tone.success.role.paper.border,
  tokens.surface.tone.success.role.paper.foreground,
  tokens.feedback.success.foreground,
  tokens.feedback.success.background,
  tokens.feedback.success.hover,
  tokens.feedback.success.border,
  tokens.feedback.error.foreground,
  tokens.feedback.error.background,
  tokens.feedback.error.hover,
  tokens.feedback.error.border,
  tokens.feedback.warning.foreground,
  tokens.feedback.warning.background,
  tokens.feedback.warning.hover,
  tokens.feedback.warning.border,
  tokens.feedback.info.foreground,
  tokens.feedback.info.background,
  tokens.feedback.info.hover,
  tokens.feedback.info.border,
  tokens.selection.background,
  tokens.selection.foreground,
] as const;

type SpaceToken = (typeof spaceTokens)[number];
type RadiusToken = (typeof radiusTokens)[number];
type ColorToken = (typeof colorTokens)[number];
type SpaceAlias =
  | '0'
  | '0.5'
  | '1'
  | '1.5'
  | '2'
  | '2.5'
  | '3'
  | '3.5'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '10'
  | '12';
type RadiusAlias = '0' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
type FontSizeAlias = 'micro' | 'tiny' | 'xs' | 'sm' | 'base' | 'lg' | 'xl';
type ColorAlias =
  | 'foreground'
  | 'foregroundBody'
  | 'foregroundMuted'
  | 'foregroundPassive'
  | 'foregroundInverse'
  | 'foregroundDestructive'
  | 'foregroundDestructiveMuted'
  | 'foregroundNeutral'
  | 'foregroundSuccess'
  | 'foregroundError'
  | 'foregroundWarning'
  | 'foregroundInfo'
  | 'primaryButtonForeground'
  | 'surfaceForeground'
  | 'surfaceDestructiveForeground'
  | 'surfaceWarningForeground'
  | 'surfaceInfoForeground';
type BackgroundAlias =
  | 'background'
  | 'background1'
  | 'background2'
  | 'background3'
  | 'backgroundDestructive'
  | 'backgroundDestructive1'
  | 'backgroundNeutral'
  | 'backgroundSuccess'
  | 'backgroundSuccessHover'
  | 'backgroundError'
  | 'backgroundErrorHover'
  | 'backgroundWarning'
  | 'backgroundWarningHover'
  | 'backgroundInfo'
  | 'backgroundInfoHover'
  | 'primaryButtonBackground'
  | 'primaryButtonBackgroundHover'
  | 'surface'
  | 'surfaceHover'
  | 'surfaceSelected'
  | 'surfaceEmphasis'
  | 'surfaceEmphasisHover'
  | 'surfaceEmphasisSelected'
  | 'surfaceInput'
  | 'surfaceSunken'
  | 'surfaceSunkenHover'
  | 'surfaceSunkenSelected'
  | 'surfaceBase'
  | 'surfaceBaseHover'
  | 'surfaceBaseSelected'
  | 'surfaceBaseEmphasis'
  | 'surfaceBaseEmphasisHover'
  | 'surfaceBaseEmphasisSelected'
  | 'surfaceElevated'
  | 'surfaceElevatedHover'
  | 'surfaceElevatedSelected'
  | 'surfaceElevatedEmphasis'
  | 'surfaceElevatedEmphasisHover'
  | 'surfaceElevatedEmphasisSelected'
  | 'surfacePaper'
  | 'surfacePaperHover'
  | 'surfacePaperSelected'
  | 'surfaceDestructive'
  | 'surfaceDestructiveHover'
  | 'surfaceDestructiveSelected'
  | 'surfaceWarning'
  | 'surfaceWarningHover'
  | 'surfaceWarningSelected'
  | 'surfaceInfo'
  | 'surfaceInfoHover'
  | 'surfaceInfoSelected';
type BorderColorAlias =
  | 'border'
  | 'border1'
  | 'border2'
  | 'borderDestructive'
  | 'borderPrimary'
  | 'borderSuccess'
  | 'borderError'
  | 'borderWarning'
  | 'borderInfo'
  | 'primaryButtonBorder'
  | 'surfaceBorder'
  | 'surfaceDestructiveBorder'
  | 'surfaceWarningBorder'
  | 'surfaceInfoBorder';

type SpacingProperties = {
  padding?: SpaceToken | SpaceAlias;
  paddingTop?: SpaceToken | SpaceAlias;
  paddingBottom?: SpaceToken | SpaceAlias;
  paddingLeft?: SpaceToken | SpaceAlias;
  paddingRight?: SpaceToken | SpaceAlias;
  gap?: SpaceToken | SpaceAlias;
  columnGap?: SpaceToken | SpaceAlias;
  rowGap?: SpaceToken | SpaceAlias;
  marginTop?: SpaceToken | SpaceAlias;
  marginBottom?: SpaceToken | SpaceAlias;
  marginLeft?: SpaceToken | SpaceAlias;
  marginRight?: SpaceToken | SpaceAlias;
  marginInline?: SpaceToken | SpaceAlias;
  p?: SpaceToken | SpaceAlias;
  px?: SpaceToken | SpaceAlias;
  py?: SpaceToken | SpaceAlias;
  mx?: SpaceToken | SpaceAlias;
  my?: SpaceToken | SpaceAlias;
};

export type StyleUtilityInput = SpacingProperties & {
  display?: 'flex' | 'grid' | 'block' | 'inline' | 'inline-block' | 'inline-flex' | 'none';
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  alignItems?: 'stretch' | 'start' | 'flex-start' | 'center' | 'end' | 'flex-end' | 'baseline';
  alignSelf?: 'auto' | 'stretch' | 'start' | 'flex-start' | 'center' | 'end' | 'flex-end';
  justifyContent?:
    | 'stretch'
    | 'start'
    | 'flex-start'
    | 'center'
    | 'end'
    | 'flex-end'
    | 'space-between';
  justifySelf?: 'auto' | 'stretch' | 'start' | 'flex-start' | 'center' | 'end' | 'flex-end';
  flexWrap?: 'nowrap' | 'wrap';
  flex?: '1' | 'none' | 'auto';
  flexShrink?: 0 | 1;
  flexGrow?: 0 | 1;
  position?: 'static' | 'relative' | 'absolute' | 'sticky' | 'fixed';
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll';
  overflowX?: 'visible' | 'hidden' | 'auto';
  overflowY?: 'visible' | 'hidden' | 'auto' | 'scroll';
  width?: 'full' | 'auto' | '0';
  height?: 'full' | 'auto' | '0';
  minWidth?: '0' | 'full';
  minHeight?: '0' | 'full';
  maxWidth?: 'full' | 'none';
  maxHeight?: 'full' | 'none';
  inset?: '0';
  top?: '0' | 'auto';
  right?: '0' | 'auto';
  bottom?: '0' | 'auto';
  left?: '0' | 'auto';
  zIndex?: '0' | '10' | '20' | '30' | '50';
  pointerEvents?: 'none' | 'auto' | 'all';
  visibility?: 'visible' | 'hidden';
  shrink?: '0' | '1';
  fontSize?: FontSizeAlias | (typeof tokens.typography.size)[keyof typeof tokens.typography.size];
  fontWeight?: 'normal' | (typeof tokens.typography.weight)[keyof typeof tokens.typography.weight];
  lineHeight?: 'none' | 'tight' | 'snug' | 'normal';
  whiteSpace?: 'nowrap' | 'pre' | 'pre-wrap' | 'normal';
  textOverflow?: 'ellipsis' | 'clip';
  wordBreak?: 'break-all' | 'break-word' | 'normal';
  userSelect?: 'none' | 'auto' | 'all' | 'text';
  cursor?: 'default' | 'pointer' | 'text' | 'not-allowed' | 'auto';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textAlign?: 'left' | 'center' | 'right';
  fontStyle?: 'normal' | 'italic';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  fontFamily?: 'sans' | 'mono';
  color?: ColorToken | ColorAlias | 'current' | 'currentColor' | 'inherit';
  background?: ColorToken | BackgroundAlias | 'none' | 'transparent';
  borderColor?: ColorToken | BorderColorAlias | 'current' | 'transparent';
  outlineColor?: 'border' | 'borderPrimary' | 'borderDestructive';
  borderWidth?: '0' | '1' | '2';
  borderTopWidth?: '0' | '1' | '2' | '3';
  borderBottomWidth?: '0' | '1' | '2' | '3';
  borderLeftWidth?: '0' | '1' | '2' | '3';
  borderRightWidth?: '0' | '1' | '2' | '3';
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  borderRadius?: RadiusToken | RadiusAlias;
  rounded?: RadiusToken | RadiusAlias;
  borderTopLeftRadius?: RadiusToken | RadiusAlias;
  borderTopRightRadius?: RadiusToken | RadiusAlias;
  borderBottomLeftRadius?: RadiusToken | RadiusAlias;
  borderBottomRightRadius?: RadiusToken | RadiusAlias;
  roundedTop?: RadiusToken | RadiusAlias;
  roundedBottom?: RadiusToken | RadiusAlias;
  roundedLeft?: RadiusToken | RadiusAlias;
  roundedRight?: RadiusToken | RadiusAlias;
  opacity?: '0' | '50' | '75' | '100';
  boxShadow?: 'none' | 'sm' | 'md' | 'lg' | 'overlay';
};
export type StyleUtilityProperty = keyof StyleUtilityInput;

function values<T extends readonly string[]>(items: T): Record<T[number], T[number]> {
  return Object.fromEntries(items.map((item) => [item, item])) as Record<T[number], T[number]>;
}

const spaces = {
  '0': tokens.space.step0,
  '0.5': tokens.space.step0_5,
  '1': tokens.space.step1,
  '1.5': tokens.space.step1_5,
  '2': tokens.space.step2,
  '2.5': tokens.space.step2_5,
  '3': tokens.space.step3,
  '3.5': tokens.space.step3_5,
  '4': tokens.space.step4,
  '5': tokens.space.step5,
  '6': tokens.space.step6,
  '7': tokens.space.step7,
  '8': tokens.space.step8,
  '10': tokens.space.step10,
  '12': tokens.space.step12,
  ...values(spaceTokens),
};

const radii = {
  '0': '0',
  xs: tokens.radius.xs,
  sm: tokens.radius.sm,
  md: tokens.radius.md,
  lg: tokens.radius.lg,
  xl: tokens.radius.xl,
  '2xl': tokens.radius.twoXl,
  full: tokens.radius.full,
  ...values(radiusTokens),
};

const colors = {
  inherit: 'inherit',
  current: 'currentColor',
  currentColor: 'currentColor',
  foreground: tokens.foreground.default,
  foregroundBody: tokens.foreground.body,
  foregroundMuted: tokens.foreground.muted,
  foregroundPassive: tokens.foreground.passive,
  foregroundInverse: tokens.foreground.inverse,
  foregroundDestructive: tokens.palette.red.step11,
  foregroundDestructiveMuted: tokens.palette.red.step9,
  foregroundNeutral: tokens.palette.neutral.step1,
  foregroundSuccess: tokens.feedback.success.foreground,
  foregroundError: tokens.feedback.error.foreground,
  foregroundWarning: tokens.feedback.warning.foreground,
  foregroundInfo: tokens.feedback.info.foreground,
  primaryButtonForeground: tokens.palette.accent.contrast,
  surfaceForeground: tokens.surface.current.foreground,
  surfaceDestructiveForeground: tokens.surface.tone.destructive.foreground,
  surfaceWarningForeground: tokens.surface.tone.warning.foreground,
  surfaceInfoForeground: tokens.surface.tone.info.foreground,
  ...values(colorTokens),
};

const backgrounds = {
  none: 'transparent',
  transparent: 'transparent',
  background: tokens.palette.neutral.step1,
  background1: tokens.palette.neutral.step2,
  background2: tokens.palette.neutral.step3,
  background3: tokens.palette.neutral.step4,
  backgroundDestructive: tokens.palette.red.step3,
  backgroundDestructive1: tokens.palette.red.step2,
  backgroundNeutral: tokens.palette.neutral.step12,
  backgroundSuccess: tokens.feedback.success.background,
  backgroundSuccessHover: tokens.feedback.success.hover,
  backgroundError: tokens.feedback.error.background,
  backgroundErrorHover: tokens.feedback.error.hover,
  backgroundWarning: tokens.feedback.warning.background,
  backgroundWarningHover: tokens.feedback.warning.hover,
  backgroundInfo: tokens.feedback.info.background,
  backgroundInfoHover: tokens.feedback.info.hover,
  primaryButtonBackground: tokens.palette.accent.step9,
  primaryButtonBackgroundHover: tokens.palette.accent.step10,
  surface: tokens.surface.current.background,
  surfaceHover: tokens.surface.current.hover,
  surfaceSelected: tokens.surface.current.selected,
  surfaceEmphasis: tokens.surface.current.emphasis,
  surfaceEmphasisHover: tokens.surface.current.emphasisHover,
  surfaceEmphasisSelected: tokens.surface.current.emphasisSelected,
  surfaceInput: tokens.surface.current.input,
  surfaceSunken: tokens.surface.level.sunken.background,
  surfaceSunkenHover: tokens.surface.level.sunken.hover,
  surfaceSunkenSelected: tokens.surface.level.sunken.selected,
  surfaceBase: tokens.surface.level.base.background,
  surfaceBaseHover: tokens.surface.level.base.hover,
  surfaceBaseSelected: tokens.surface.level.base.selected,
  surfaceBaseEmphasis: tokens.surface.level.raised.background,
  surfaceBaseEmphasisHover: tokens.surface.level.raised.hover,
  surfaceBaseEmphasisSelected: tokens.surface.level.raised.selected,
  surfaceElevated: tokens.surface.level.elevated.background,
  surfaceElevatedHover: tokens.surface.level.elevated.hover,
  surfaceElevatedSelected: tokens.surface.level.elevated.selected,
  surfaceElevatedEmphasis: tokens.surface.level.overlay.background,
  surfaceElevatedEmphasisHover: tokens.surface.level.overlay.hover,
  surfaceElevatedEmphasisSelected: tokens.surface.level.overlay.selected,
  surfacePaper: tokens.surface.role.paper.background,
  surfacePaperHover: tokens.surface.role.paper.hover,
  surfacePaperSelected: tokens.surface.role.paper.selected,
  surfaceDestructive: tokens.surface.tone.destructive.background,
  surfaceDestructiveHover: tokens.surface.tone.destructive.hover,
  surfaceDestructiveSelected: tokens.surface.tone.destructive.selected,
  surfaceWarning: tokens.surface.tone.warning.background,
  surfaceWarningHover: tokens.surface.tone.warning.hover,
  surfaceWarningSelected: tokens.surface.tone.warning.selected,
  surfaceInfo: tokens.surface.tone.info.background,
  surfaceInfoHover: tokens.surface.tone.info.hover,
  surfaceInfoSelected: tokens.surface.tone.info.selected,
  ...values(colorTokens),
};

const borderColors = {
  transparent: 'transparent',
  current: 'currentColor',
  border: tokens.border.default,
  border1: tokens.border.muted,
  border2: tokens.border.strong,
  borderDestructive: tokens.border.destructive,
  borderPrimary: tokens.border.focus,
  borderSuccess: tokens.feedback.success.border,
  borderError: tokens.feedback.error.border,
  borderWarning: tokens.feedback.warning.border,
  borderInfo: tokens.feedback.info.border,
  primaryButtonBorder: tokens.palette.accent.step7,
  surfaceBorder: tokens.surface.current.border,
  surfaceDestructiveBorder: tokens.surface.tone.destructive.border,
  surfaceWarningBorder: tokens.surface.tone.warning.border,
  surfaceInfoBorder: tokens.surface.tone.info.border,
  ...values(colorTokens),
};

const utilityProperties = defineProperties({
  '@layer': layerNames.utilities,
  properties: {
    display: ['flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'none'],
    flexDirection: ['row', 'row-reverse', 'column', 'column-reverse'],
    alignItems: ['stretch', 'start', 'flex-start', 'center', 'end', 'flex-end', 'baseline'],
    alignSelf: ['auto', 'stretch', 'start', 'flex-start', 'center', 'end', 'flex-end'],
    justifyContent: [
      'stretch',
      'start',
      'flex-start',
      'center',
      'end',
      'flex-end',
      'space-between',
    ],
    justifySelf: ['auto', 'stretch', 'start', 'flex-start', 'center', 'end', 'flex-end'],
    flexWrap: ['nowrap', 'wrap'],
    flex: { '1': '1 1 0%', none: 'none', auto: '1 1 auto' },
    flexShrink: { 0: 0, 1: 1 },
    flexGrow: { 0: 0, 1: 1 },
    position: ['static', 'relative', 'absolute', 'sticky', 'fixed'],
    overflow: ['visible', 'hidden', 'auto', 'scroll'],
    overflowX: ['visible', 'hidden', 'auto'],
    overflowY: ['visible', 'hidden', 'auto', 'scroll'],
    width: { full: '100%', auto: 'auto', '0': '0' },
    height: { full: '100%', auto: 'auto', '0': '0' },
    minWidth: { '0': '0', full: '100%' },
    minHeight: { '0': '0', full: '100%' },
    maxWidth: { full: '100%', none: 'none' },
    maxHeight: { full: '100%', none: 'none' },
    inset: { '0': '0' },
    top: { '0': '0', auto: 'auto' },
    right: { '0': '0', auto: 'auto' },
    bottom: { '0': '0', auto: 'auto' },
    left: { '0': '0', auto: 'auto' },
    zIndex: { '0': 0, '10': 10, '20': 20, '30': 30, '50': 50 },
    pointerEvents: ['none', 'auto', 'all'],
    visibility: ['visible', 'hidden'],
    shrink: { '0': 0, '1': 1 },
    padding: spaces,
    paddingTop: spaces,
    paddingBottom: spaces,
    paddingLeft: spaces,
    paddingRight: spaces,
    gap: spaces,
    columnGap: spaces,
    rowGap: spaces,
    marginTop: spaces,
    marginBottom: spaces,
    marginLeft: spaces,
    marginRight: spaces,
    marginInline: spaces,
    fontSize: {
      micro: tokens.typography.size.micro,
      tiny: tokens.typography.size.tiny,
      xs: tokens.typography.size.xs,
      sm: tokens.typography.size.sm,
      base: tokens.typography.size.base,
      lg: tokens.typography.size.lg,
      xl: tokens.typography.size.xl,
      ...values(Object.values(tokens.typography.size)),
    },
    fontWeight: {
      normal: tokens.typography.weight.normal,
      ...values(Object.values(tokens.typography.weight)),
    },
    lineHeight: { none: 1, tight: 1.25, snug: 1.375, normal: 1.5 },
    whiteSpace: ['nowrap', 'pre', 'pre-wrap', 'normal'],
    textOverflow: ['ellipsis', 'clip'],
    wordBreak: ['break-all', 'break-word', 'normal'],
    userSelect: ['none', 'auto', 'all', 'text'],
    cursor: ['default', 'pointer', 'text', 'not-allowed', 'auto'],
    textDecoration: ['none', 'underline', 'line-through'],
    textAlign: ['left', 'center', 'right'],
    fontStyle: ['normal', 'italic'],
    textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
    fontFamily: {
      sans: tokens.typography.family.sans,
      mono: tokens.typography.family.mono,
    },
    color: colors,
    background: backgrounds,
    borderColor: borderColors,
    outlineColor: {
      border: tokens.border.default,
      borderPrimary: tokens.border.focus,
      borderDestructive: tokens.border.destructive,
    },
    borderWidth: { '0': '0', '1': '1px', '2': '2px' },
    borderTopWidth: { '0': '0', '1': '1px', '2': '2px', '3': '3px' },
    borderBottomWidth: { '0': '0', '1': '1px', '2': '2px', '3': '3px' },
    borderLeftWidth: { '0': '0', '1': '1px', '2': '2px', '3': '3px' },
    borderRightWidth: { '0': '0', '1': '1px', '2': '2px', '3': '3px' },
    borderStyle: ['solid', 'dashed', 'dotted', 'none'],
    borderRadius: radii,
    borderTopLeftRadius: radii,
    borderTopRightRadius: radii,
    borderBottomLeftRadius: radii,
    borderBottomRightRadius: radii,
    opacity: { '0': 0, '50': 0.5, '75': 0.75, '100': 1 },
    boxShadow: {
      none: 'none',
      sm: tokens.shadow.sm,
      md: tokens.shadow.md,
      lg: tokens.shadow.lg,
      overlay: tokens.shadow.overlay,
    },
  },
  shorthands: {
    px: ['paddingLeft', 'paddingRight'],
    py: ['paddingTop', 'paddingBottom'],
    p: ['padding'],
    mx: ['marginLeft', 'marginRight'],
    my: ['marginTop', 'marginBottom'],
    rounded: ['borderRadius'],
    roundedTop: ['borderTopLeftRadius', 'borderTopRightRadius'],
    roundedBottom: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
    roundedLeft: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
    roundedRight: ['borderTopRightRadius', 'borderBottomRightRadius'],
  },
});

/**
 * Finite Token-backed utilities emitted in `emdash.utilities`.
 *
 * The generated `properties` metadata is the static composition vocabulary
 * consumed by styling lint rules; aliases expand to their canonical properties.
 *
 * Use `sx` for local atomic layout or an intentional override on a component's
 * documented root. Recurring visual behavior belongs in a Recipe.
 *
 * @example
 * ```tsx
 * <Button className={sx({ width: 'full', marginTop: tokens.space.step2 })}>
 *   Continue
 * </Button>
 * ```
 */
const sxImplementation = createSprinkles(utilityProperties);
export const sx = sxImplementation as ((input: StyleUtilityInput) => string) & {
  readonly properties: ReadonlySet<StyleUtilityProperty>;
};
