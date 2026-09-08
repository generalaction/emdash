/**
 * Public UI styling prelude.
 *
 * Import author-owned styles, recipes, utilities, and class composition from
 * `@emdash/ui/styles`. Layer placement is owned by this module; callers cannot
 * select a cascade layer. Use `sx` in a component's root `className` as the
 * supported caller override seam.
 */

import { createLayerStyle } from './authoring/layer-rule';
import { createLayerRecipe } from './authoring/recipe';
import type { CallableRecipe, RecipeConfig, VariantMap } from './authoring/recipe';
import type { AuthoringStyleInput, AuthoringStyleRule } from './authoring/types';
import { joinClassNames } from './classnames';
import { layerNames } from './authoring/layers.css';
import { sx } from './authoring/sx.css';
import type { StyleUtilityInput, StyleUtilityProperty } from './authoring/sx.css';

export type ClassName = string;
export type CxInput = ClassName | false | null | undefined | readonly ClassName[];
export type StyleInput = AuthoringStyleInput;
export type StyleRule = AuthoringStyleRule;
export type { VariantProps } from './authoring/recipe';
export type { StyleUtilityInput, StyleUtilityProperty };
export { sx };

/**
 * Creates an Emdash-owned class in `emdash.recipes`.
 *
 * Layer selection is intentionally unavailable to callers.
 */
export function style(input: StyleInput): ClassName {
  return createLayerStyle(input, layerNames.recipes);
}

/**
 * Creates a callable-only Recipe whose base, variants, and compound variants
 * all emit in `emdash.recipes`. Vanilla Extract metadata is intentionally not
 * part of the public return type.
 */
export function recipe<const Variants extends VariantMap>(
  config: RecipeConfig<Variants>
): CallableRecipe<Variants> {
  return createLayerRecipe(config, layerNames.recipes);
}

/**
 * Joins class names without merge or de-duplication semantics.
 *
 * Only strings, supported falsy conditionals, and flat string arrays are
 * accepted. Objects, numbers, callbacks, and nested heterogeneous arrays are
 * intentionally outside the public authoring contract.
 */
export function cx(...classes: CxInput[]): ClassName {
  return joinClassNames(...classes);
}
