export type MessageVars = {
  cardBorder: number;
  collapsedMaxH: number;
  expandedMaxH: number;
  userCardPadX: number;
  userCardPadY: number;
  stackPadY: number;
  attachThumb: number;
  attachGap: number;
  footerH: number;
};

/** Subset of MessageVars projected into CSS via the VE contract. */
export type MessageStyleVars = {
  userCardPadX: number;
  userCardPadY: number;
  cardBorder: number;
  attachThumb: number;
  attachGap: number;
};

/** Available width for block layout inside the user card. */
export function userInnerWidth(ctxWidth: number, vars: MessageVars): number {
  return Math.max(1, ctxWidth - 2 * vars.userCardPadX - 2 * vars.cardBorder);
}
