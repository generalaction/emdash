/**
 * Private shared-package Adapter authoring.
 *
 * Only modules listed in the rooted Global Adapter registry may import this
 * interface. It is intentionally absent from package exports.
 */
import { createGlobalLayerStyle } from './authoring/layer-rule';
import type { AuthoringStyleRule } from './authoring/types';
import { layerNames } from './authoring/layers.css';

/** Places one registered rooted foreign-DOM rule in `emdash.recipes`. */
export function globalStyle(selector: string, rule: AuthoringStyleRule): void {
  createGlobalLayerStyle(selector, rule, layerNames.recipes);
}
