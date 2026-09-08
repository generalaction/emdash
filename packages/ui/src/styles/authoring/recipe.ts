import { recipe as vanillaRecipe } from '@vanilla-extract/recipes';
import { inLayer } from './layer-rule';
import type { AuthoringStyleInput } from './types';

export type VariantMap = Record<string, Record<string, AuthoringStyleInput>>;
type VariantValue<Values extends Record<string, AuthoringStyleInput>> = keyof Values extends
  | 'true'
  | 'false'
  ? boolean
  : keyof Values;
export type VariantSelection<Variants extends VariantMap> = {
  [Name in keyof Variants]?: VariantValue<Variants[Name]>;
};
export type CallableRecipe<Variants extends VariantMap> = (
  selection?: VariantSelection<Variants>
) => string;
export type RecipeConfig<Variants extends VariantMap> = {
  base?: AuthoringStyleInput;
  variants: Variants;
  defaultVariants?: VariantSelection<Variants>;
  compoundVariants?: ReadonlyArray<{
    variants: VariantSelection<Variants>;
    style: AuthoringStyleInput;
  }>;
};

export type VariantProps<RecipeType> = RecipeType extends (selection?: infer Selection) => string
  ? NonNullable<Selection>
  : never;

export function createLayerRecipe<const Variants extends VariantMap>(
  config: RecipeConfig<Variants>,
  layerName: string
): CallableRecipe<Variants> {
  const variants = Object.fromEntries(
    Object.entries(config.variants).map(([name, values]) => [
      name,
      Object.fromEntries(
        Object.entries(values).map(([value, input]) => [value, inLayer(input, layerName)])
      ),
    ])
  );
  const compoundVariants = config.compoundVariants?.map((compoundVariant) => ({
    variants: compoundVariant.variants,
    style: inLayer(compoundVariant.style, layerName),
  }));
  const implementation = vanillaRecipe({
    base: config.base ? inLayer(config.base, layerName) : undefined,
    variants,
    defaultVariants: config.defaultVariants,
    compoundVariants,
  } as never);

  return implementation as CallableRecipe<Variants>;
}
