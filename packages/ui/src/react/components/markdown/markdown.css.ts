import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

// Element styles for the two Markdown variants, ported from the legacy
// Tailwind component maps onto @emdash/ui tokens. The full variant reads like
// a document; the compact variant is denser for previews and comment bodies.

const mutedTint = (percent: number) =>
  `color-mix(in srgb, ${tokens.palette.neutral.step3} ${percent}%, transparent)`;

// ── Shared ────────────────────────────────────────────────────────────────────

/** Owned root for the React Markdown foreign-DOM boundary. */
export const markdownAdapter = style({
  minWidth: 0,
});

export const link = style({
  color: tokens.feedback.info.foreground,
  textDecoration: 'underline',
  textDecorationColor: `color-mix(in srgb, ${tokens.feedback.info.foreground} 50%, transparent)`,
  ':hover': {
    textDecorationColor: tokens.feedback.info.foreground,
  },
});

export const strong = style({
  fontWeight: 600,
  color: tokens.foreground.default,
});

export const taskCheckbox = style({
  marginRight: '0.5rem',
  verticalAlign: 'middle',
  pointerEvents: 'none',
  selectors: {
    // readOnly instead of disabled so the checked state keeps full contrast.
    '&:checked': { accentColor: tokens.feedback.info.foreground },
  },
});

export const listItem = style({
  lineHeight: 1.625,
  selectors: {
    '& + &': { marginTop: '0.25rem' },
    '&::marker': { color: tokens.foreground.muted },
  },
});

// ── Full variant ──────────────────────────────────────────────────────────────

const headingBase = {
  fontWeight: 600,
  color: tokens.foreground.default,
} as const;

export const h1Full = style({
  ...headingBase,
  marginTop: '1.5rem',
  marginBottom: '1rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  paddingBottom: '0.5rem',
  fontSize: '1.5rem',
  lineHeight: 1.33,
  selectors: { '&:first-child': { marginTop: 0 } },
});

export const h2Full = style({
  ...headingBase,
  marginTop: '1.5rem',
  marginBottom: '0.75rem',
  borderBottom: `1px solid ${tokens.border.default}`,
  paddingBottom: '0.5rem',
  fontSize: '1.25rem',
  lineHeight: 1.4,
  selectors: { '&:first-child': { marginTop: 0 } },
});

export const h3Full = style({
  ...headingBase,
  marginTop: '1rem',
  marginBottom: '0.5rem',
  fontSize: '1.125rem',
  lineHeight: 1.55,
});

export const h4Full = style({
  ...headingBase,
  marginTop: '1rem',
  marginBottom: '0.5rem',
  fontSize: '1rem',
  lineHeight: 1.5,
});

export const h5Full = style({
  ...headingBase,
  marginTop: '0.75rem',
  marginBottom: '0.25rem',
  fontSize: tokens.typography.size.sm,
});

export const h6Full = style({
  ...headingBase,
  marginTop: '0.75rem',
  marginBottom: '0.25rem',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const paragraphFull = style({
  marginBottom: '0.75rem',
  fontSize: tokens.typography.size.sm,
  lineHeight: 1.625,
  color: tokens.foreground.default,
});

export const unorderedListFull = style({
  marginBottom: '0.75rem',
  marginLeft: '1.5rem',
  listStyleType: 'disc',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
});

export const orderedListFull = style({
  marginBottom: '0.75rem',
  marginLeft: '1.5rem',
  listStyleType: 'decimal',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.default,
});

export const inlineCodeFull = style({
  backgroundColor: tokens.palette.neutral.step3,
  borderRadius: tokens.radius.sm,
  paddingInline: '0.375rem',
  paddingBlock: '0.125rem',
  fontFamily: tokens.typography.family.mono,
  fontSize: tokens.typography.size.xs,
});

export const preFull = style({
  marginBottom: '0.75rem',
  overflowX: 'auto',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.palette.neutral.step2,
});

export const codeBlockFull = style({
  display: 'block',
  padding: '0.75rem',
  fontFamily: tokens.typography.family.mono,
  fontSize: tokens.typography.size.xs,
  lineHeight: 1.625,
});

export const blockquoteFull = style({
  marginBottom: '0.75rem',
  borderLeft: `4px solid ${tokens.border.default}`,
  backgroundColor: mutedTint(30),
  paddingBlock: '0.25rem',
  paddingLeft: '1rem',
  fontSize: tokens.typography.size.sm,
  fontStyle: 'italic',
  color: tokens.foreground.muted,
});

export const tableWrapperFull = style({
  marginBottom: '0.75rem',
  overflowX: 'auto',
});

export const tableFull = style({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: tokens.typography.size.sm,
});

export const tableHeadFull = style({
  backgroundColor: mutedTint(30),
  borderBottom: `1px solid ${tokens.border.default}`,
});

export const tableHeaderCellFull = style({
  paddingInline: '0.75rem',
  paddingBlock: '0.5rem',
  textAlign: 'left',
  fontWeight: 600,
  color: tokens.foreground.default,
});

export const tableCellFull = style({
  borderTop: `1px solid ${tokens.border.default}`,
  paddingInline: '0.75rem',
  paddingBlock: '0.5rem',
  color: tokens.foreground.default,
});

export const dividerFull = style({
  marginBlock: '1.5rem',
  border: 'none',
  borderTop: `1px solid ${tokens.border.default}`,
});

export const imageContainerFull = style({
  marginBlock: '0.75rem',
});

export const imageFull = style({
  maxWidth: '100%',
  borderRadius: tokens.radius.sm,
});

export const imagePlaceholder = style({
  display: 'inline-block',
  marginBlock: '0.75rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

// ── Compact variant ───────────────────────────────────────────────────────────

export const h1Compact = style({
  ...headingBase,
  marginTop: '0.75rem',
  marginBottom: '0.25rem',
  fontSize: tokens.typography.size.sm,
  selectors: { '&:first-child': { marginTop: 0 } },
});

export const h3Compact = style({
  ...headingBase,
  marginTop: '0.5rem',
  marginBottom: '0.25rem',
  fontSize: tokens.typography.size.xs,
});

export const paragraphCompact = style({
  marginBottom: '0.5rem',
  lineHeight: 1.625,
});

export const unorderedListCompact = style({
  marginBottom: '0.5rem',
  marginLeft: '1rem',
  listStyleType: 'disc',
});

export const orderedListCompact = style({
  marginBottom: '0.5rem',
  marginLeft: '1rem',
  listStyleType: 'decimal',
});

export const inlineCodeCompact = style({
  backgroundColor: mutedTint(60),
  borderRadius: tokens.radius.sm,
  paddingInline: '0.25rem',
  paddingBlock: '0.125rem',
  fontFamily: tokens.typography.family.mono,
  fontSize: '0.92em',
});

export const codeBlockCompact = style({
  display: 'block',
  overflowX: 'auto',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: mutedTint(60),
  padding: '0.5rem',
  fontFamily: tokens.typography.family.mono,
  fontSize: '11px',
  lineHeight: 1.625,
});

export const preCompact = style({
  marginBottom: '0.5rem',
  overflowX: 'auto',
});

export const blockquoteCompact = style({
  marginBottom: '0.5rem',
  borderLeft: `2px solid ${tokens.border.default}`,
  paddingLeft: '0.75rem',
  fontStyle: 'italic',
  color: tokens.foreground.muted,
});

export const tableWrapperCompact = style({
  marginBlock: '0.75rem',
  overflowX: 'auto',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
});

export const tableCompact = style({
  width: '100%',
  minWidth: 'max-content',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '11px',
  lineHeight: 1.375,
});

export const tableHeadCompact = style({
  backgroundColor: mutedTint(50),
  borderBottom: `1px solid ${tokens.border.default}`,
  color: tokens.foreground.default,
});

export const tableHeaderCellCompact = style({
  borderRight: `1px solid ${tokens.border.default}`,
  paddingInline: '0.625rem',
  paddingBlock: '0.375rem',
  fontWeight: 600,
  selectors: { '&:last-child': { borderRight: 'none' } },
});

export const tableCellCompact = style({
  borderTop: `1px solid ${tokens.border.default}`,
  borderRight: `1px solid ${tokens.border.default}`,
  paddingInline: '0.625rem',
  paddingBlock: '0.375rem',
  verticalAlign: 'top',
  selectors: { '&:last-child': { borderRight: 'none' } },
});

export const dividerCompact = style({
  marginBlock: '1rem',
  border: 'none',
  borderTop: `1px solid ${tokens.border.default}`,
});

export const linkCompact = style({
  color: tokens.feedback.info.foreground,
  textDecoration: 'underline',
});

export const imageContainerCompact = style({
  marginBlock: '0.5rem',
});

export const imageCompact = style({
  height: 'auto',
  maxHeight: '20rem',
  maxWidth: '100%',
  borderRadius: tokens.radius.sm,
});

// ── Mermaid ───────────────────────────────────────────────────────────────────

export const mermaidPreviewContainer = style({
  position: 'relative',
  overflowX: 'auto',
  borderRadius: tokens.radius.md,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.palette.neutral.step1,
});

export const mermaidExpandButton = style({
  position: 'absolute',
  top: '0.25rem',
  right: '0.25rem',
  zIndex: 10,
  opacity: 0,
  transition: 'opacity 150ms',
  backgroundColor: tokens.surface.current.background,
  boxShadow: `${tokens.shadow.sm}, 0 0 0 1px color-mix(in srgb, ${tokens.border.default} 80%, transparent)`,
  selectors: {
    [`${mermaidPreviewContainer}:hover &`]: { opacity: 1 },
    '&:focus-visible': { opacity: 1 },
  },
});

export const mermaidPreview = style({
  minWidth: 'fit-content',
  cursor: 'zoom-in',
  padding: '0.5rem',
  color: tokens.foreground.default,
});

export const mermaidPreviewCompact = style({
  padding: '0.375rem',
});

export const mermaidDialogContent = style({
  color: tokens.foreground.default,
});

export const mermaidError = style({
  marginBlock: '0.75rem',
  borderRadius: tokens.radius.md,
  border: `1px solid color-mix(in srgb, ${tokens.border.destructive} 30%, transparent)`,
  backgroundColor: `color-mix(in srgb, ${tokens.palette.red.step3} 40%, transparent)`,
  padding: '0.75rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.palette.red.step11,
});

export const mermaidErrorCompact = style({
  marginBlock: '0.5rem',
  padding: '0.5rem',
  fontSize: '11px',
});

export const mermaidErrorTitle = style({
  fontWeight: 500,
});

export const mermaidErrorMessage = style({
  marginTop: '0.25rem',
  color: tokens.foreground.muted,
});

export const mermaidErrorSource = style({
  marginTop: '0.5rem',
  overflowX: 'auto',
  borderRadius: tokens.radius.sm,
  backgroundColor: mutedTint(60),
  padding: '0.5rem',
  fontFamily: tokens.typography.family.mono,
  color: tokens.foreground.muted,
});
