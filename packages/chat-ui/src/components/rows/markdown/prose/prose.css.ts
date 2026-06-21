import { style } from '@vanilla-extract/css';
import { vars } from '../../../../styles/theme.css';
import { proseVars } from './prose-vars.css';

/** A pre-laid-out line row. Height is set via inline style from the line-height constant. */
export const pline = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'baseline',
});

/**
 * white-space: pre and line-height: 1 feed pretext and must NOT be changed to utility classes.
 * top:50% + translateY(-50%) centers each fragment within its line band.
 */
export const pf = style({
  display: 'inline-block',
  whiteSpace: 'pre',
  lineHeight: 1,
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
});

export const pfBody = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyFontWeight,
  fontFamily: vars.typeBodyFontFamily,
});

export const pfBold = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyBoldFontWeight,
  fontFamily: vars.typeBodyFontFamily,
});

export const pfItalic = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyFontWeight,
  fontStyle: 'italic',
  fontFamily: vars.typeBodyFontFamily,
});

export const pfBoldItalic = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyBoldFontWeight,
  fontStyle: 'italic',
  fontFamily: vars.typeBodyFontFamily,
});

export const pfLink = style({
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyLinkFontWeight,
  fontFamily: vars.typeBodyFontFamily,
  // color, text-decoration, cursor — applied in Prose.tsx via sprinkles
});

export const pfH1 = style({
  fontSize: vars.typeH1FontSize,
  fontWeight: vars.typeH1FontWeight,
  fontFamily: vars.typeH1FontFamily,
});

export const pfH2 = style({
  fontSize: vars.typeH2FontSize,
  fontWeight: vars.typeH2FontWeight,
  fontFamily: vars.typeH2FontFamily,
});

/** h3–h6 share the h3 scale. */
export const pfH3 = style({
  fontSize: vars.typeH3FontSize,
  fontWeight: vars.typeH3FontWeight,
  fontFamily: vars.typeH3FontFamily,
});

/** Inline code chip — font metrics and padding feed pretext measurement. */
export const pfInlineCode = style({
  fontSize: vars.typeInlineCodeFontSize,
  fontWeight: vars.typeInlineCodeFontWeight,
  fontFamily: vars.typeInlineCodeFontFamily,
  paddingTop: vars.icPadY,
  paddingBottom: vars.icPadY,
  paddingLeft: vars.icPadX,
  paddingRight: vars.icPadX,
});

export const pfMention = style({
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: vars.typeBodyFontFamily,
  paddingTop: proseVars.mentionPadY,
  paddingBottom: proseVars.mentionPadY,
  paddingLeft: proseVars.mentionPadX,
  paddingRight: proseVars.mentionPadX,
});

export const pfVariants: Record<string, string> = {
  'pf--body': pfBody,
  'pf--bold': pfBold,
  'pf--italic': pfItalic,
  'pf--bold-italic': pfBoldItalic,
  'pf--link': pfLink,
  'pf--h1': pfH1,
  'pf--h2': pfH2,
  'pf--h3': pfH3,
  'pf--h4': pfH3,
  'pf--h5': pfH3,
  'pf--h6': pfH3,
  'pf--inline-code': pfInlineCode,
  'pf--mention': pfMention,
};

export const pbullet = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transform: 'translate(-50%, -50%)',
  fontSize: vars.typeBodyFontSize,
  fontFamily: vars.typeBodyFontFamily,
  lineHeight: 1,
  // color — applied via sprinkles in Prose.tsx
});

export const pquoteRail = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: '3px',
  // background and borderRadius — applied in Prose.tsx
});
