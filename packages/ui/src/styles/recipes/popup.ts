import { joinClassNames } from '../classnames';
import type {
  PopupAppearance,
  PopupLevel,
  PopupMotion,
  PopupRadius,
  PopupShadow,
} from './popup-contract';
import { popupShadowValues } from './popup-contract';
import { surface } from './surface';
import { popupRecipe } from './popup.css';

interface PopupOptions {
  appearance?: PopupAppearance;
  bordered?: boolean;
  level?: PopupLevel;
  motion?: PopupMotion;
  radius?: PopupRadius;
  shadow?: PopupShadow;
}

/**
 * Private overlay-shell Recipe used by owned popup components.
 *
 * It owns Surface composition, depth, border/radius geometry, and Base UI
 * open/closed/collision-side motion. Component modules own only their distinct
 * placement, sizing, overflow, and anatomy.
 */
export function popup({
  appearance = 'surface',
  bordered = false,
  level = 'elevated',
  motion = 'positioned',
  radius = 'md',
  shadow = 'sm',
}: PopupOptions = {}): string {
  return joinClassNames(
    appearance === 'surface' && surface({ level }),
    popupRecipe({ appearance, bordered, motion, radius, shadow })
  );
}

/** @internal Shared only with rooted foreign-overlay Adapters. */
export function popupShadowValue(shadow: PopupShadow): string {
  return popupShadowValues[shadow];
}
