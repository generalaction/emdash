import { menuItemRecipe } from './menu-item.css';

export const MENU_ITEM_TONES = ['neutral', 'destructive'] as const;

export type MenuItemTone = (typeof MENU_ITEM_TONES)[number];

export interface MenuItemOptions {
  /** Semantic intent for the row. @default 'neutral' */
  tone?: MenuItemTone;
  /** Leaves space for a trailing check or radio indicator. @default false */
  trailingIndicator?: boolean;
  /** Makes the row span its containing list. @default false */
  fullWidth?: boolean;
  /** Aligns text with rows that have a leading icon. @default false */
  inset?: boolean;
  /** Starts supporting choice rows de-emphasized until active. @default false */
  muted?: boolean;
}

/**
 * Returns the complete shared class for a selectable menu or listbox row.
 *
 * The Recipe owns row geometry and native/Base UI hover, focus, highlighted,
 * selected, checked, nested-open, and disabled states. Put the returned class
 * on the interactive row root; component modules may add anatomy-only classes
 * for documented child slots.
 *
 * @example
 * ```ts
 * export const commandRow = style([
 *   menuItem({ fullWidth: true, trailingIndicator: true }),
 *   { minWidth: 0 },
 * ]);
 * ```
 */
export function menuItem(options: MenuItemOptions = {}): string {
  return menuItemRecipe(options);
}
