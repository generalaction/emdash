/**
 * Restricted Host Styling Adapter authoring.
 *
 * Import this subpath only from declared host-owned Adapter modules. It emits
 * host rules into `emdash.host` and exposes no layer-selection primitive.
 */

import type { TokenReference } from '@emdash/theme';
import { createLayerStyle, createRootedLayerAdapter } from './authoring/layer-rule';
import { createLayerRecipe } from './authoring/recipe';
import type { CallableRecipe, RecipeConfig, VariantMap } from './authoring/recipe';
import type { AuthoringStyleInput, AuthoringStyleRule } from './authoring/types';
import { layerNames } from './authoring/layers.css';

export type HostStyleInput = AuthoringStyleInput;
export type HostStyleRule = AuthoringStyleRule;

export type HostAdapterConfig = {
  root?: HostStyleRule;
  descendants: Readonly<Record<`&${string}`, HostStyleRule>>;
};

/** Creates a host-owned local class in `emdash.host`. */
export function hostStyle(input: HostStyleInput): string {
  return createLayerStyle(input, layerNames.host);
}

/** Creates a callable-only host-owned Recipe in `emdash.host`. */
export function hostRecipe<const Variants extends VariantMap>(
  config: RecipeConfig<Variants>
): CallableRecipe<Variants> {
  return createLayerRecipe(config, layerNames.host);
}

/**
 * Contains foreign descendant DOM beneath one generated root class.
 *
 * Descendant selectors must begin with `&`; unrestricted Global Rules are not
 * exposed through the Host Adapter entry.
 *
 * @example
 * ```ts
 * export const widgetRoot = hostAdapter({
 *   descendants: {
 *     '& > .foreign-row': { color: tokens.foreground.default },
 *   },
 * });
 * ```
 */
export function hostAdapter(config: HostAdapterConfig): string {
  return createRootedLayerAdapter(config.root ?? {}, config.descendants, layerNames.host);
}

type IntegrationFields = Readonly<Record<string, TokenReference>>;
type IntegrationProperty<Name extends string> = `--emdash-integration-${Name}-${string}`;
type IntegrationProperties<Name extends string, Fields extends IntegrationFields> = {
  readonly [Field in keyof Fields]: IntegrationProperty<Name>;
};
type IntegrationWriter<Name extends string> = {
  readonly vars: Readonly<Record<IntegrationProperty<Name>, TokenReference>>;
};

export type IntegrationStyleReader = {
  getPropertyValue(property: string): string;
};

export type IntegrationManifest<
  Name extends string = string,
  Fields extends IntegrationFields = IntegrationFields,
> = {
  readonly name: Name;
  readonly fields: Fields;
  readonly properties: IntegrationProperties<Name, Fields>;
  readonly declarations: Readonly<Record<IntegrationProperty<Name>, TokenReference>>;
  readonly writer: IntegrationWriter<Name>;
  read(style: IntegrationStyleReader): {
    readonly [Field in keyof Fields]: string;
  };
};

/** Extracts the imperative values read by an integration manifest. */
export type IntegrationValues<Manifest> =
  Manifest extends IntegrationManifest<string, infer Fields>
    ? { readonly [Field in keyof Fields]: string }
    : never;

function toKebabCase(value: string): string {
  return value
    .replaceAll('.', '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Defines private CSS properties, their Token-backed host declarations, and
 * the corresponding imperative reader from one checked field map.
 *
 * @example
 * ```ts
 * const editorTheme = defineIntegrationManifest('editor', {
 *   background: tokens.surface.current.background,
 *   foreground: tokens.foreground.default,
 * });
 * ```
 */
export function defineIntegrationManifest<
  const Name extends string,
  const Fields extends IntegrationFields,
>(name: Name, fields: Fields): IntegrationManifest<Name, Fields> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    throw new TypeError(`Invalid integration name: ${name}`);
  }

  const properties: Record<string, IntegrationProperty<Name>> = {};
  const declarations = {} as Record<IntegrationProperty<Name>, TokenReference>;

  for (const [field, token] of Object.entries(fields)) {
    if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/.test(field)) {
      throw new TypeError(`Invalid integration field: ${field}`);
    }
    if (!token.startsWith('var(--em-') || !token.endsWith(')')) {
      throw new TypeError(`Integration field ${field} must map to a canonical Token Reference.`);
    }
    const property =
      `--emdash-integration-${name}-${toKebabCase(field)}` as IntegrationProperty<Name>;
    if (property in declarations) {
      throw new TypeError(`Integration fields generate duplicate property: ${property}`);
    }
    properties[field] = property;
    declarations[property] = token;
  }

  return {
    name,
    fields,
    properties: properties as IntegrationProperties<Name, Fields>,
    declarations,
    writer: { vars: declarations },
    read(style) {
      return Object.fromEntries(
        Object.entries(properties).map(([field, property]) => [
          field,
          style.getPropertyValue(property).trim(),
        ])
      ) as { readonly [Field in keyof Fields]: string };
    },
  };
}
