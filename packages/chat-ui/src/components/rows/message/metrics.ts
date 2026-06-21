export type MessageVars = {
  /** Border width (px) on each side of the user card. */
  cardBorder: number;
  /** Max-height (px) of a collapsed user message card. */
  collapsedMaxH: number;
  /** Max-height (px) of an expanded user message card (with internal scroll). */
  expandedMaxH: number;
  /** Horizontal padding inside the user card on each side (px). */
  userCardPadX: number;
  /** Vertical padding inside the user card top and bottom (px). */
  userCardPadY: number;
  /** Vertical padding for the assistant/thought block stack (px). */
  stackPadY: number;
  /** Square thumbnail size (px) for an image attachment tile. */
  attachThumb: number;
  /** Gap (px) between attachment tiles and below the strip. */
  attachGap: number;
  /** Reserved height (px) for the assistant message footer (copy button row). */
  footerH: number;
};

/** Subset of MessageVars that are projected into CSS via the VE contract. */
export type MessageStyleVars = {
  userCardPadX: number;
  userCardPadY: number;
  cardBorder: number;
  attachThumb: number;
  attachGap: number;
};

export const MESSAGE_VARS: MessageVars = {
  cardBorder: 1,
  collapsedMaxH: 120,
  expandedMaxH: 360,
  userCardPadX: 16,
  userCardPadY: 16,
  stackPadY: 6,
  attachThumb: 32,
  attachGap: 8,
  footerH: 24,
};

export const MESSAGE_STYLE_VARS: MessageStyleVars = {
  userCardPadX: MESSAGE_VARS.userCardPadX,
  userCardPadY: MESSAGE_VARS.userCardPadY,
  cardBorder: MESSAGE_VARS.cardBorder,
  attachThumb: MESSAGE_VARS.attachThumb,
  attachGap: MESSAGE_VARS.attachGap,
};

/** Available width for block layout inside the user card. */
export function userInnerWidth(ctxWidth: number, vars: MessageVars): number {
  return Math.max(1, ctxWidth - 2 * vars.userCardPadX - 2 * vars.cardBorder);
}
