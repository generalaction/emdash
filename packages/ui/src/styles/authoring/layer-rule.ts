import {
  globalStyle,
  style as vanillaStyle,
  type ComplexStyleRule,
  type GlobalStyleRule,
} from '@vanilla-extract/css';
import type { AuthoringStyleInput, AuthoringStyleRule } from './types';
type LayeredStyleInput = ComplexStyleRule | string;

function assertLayerIsInfrastructureOwned(value: unknown): void {
  if (!value || typeof value !== 'object') return;

  if ('@layer' in value) {
    throw new TypeError(
      'Cascade layers are owned by @emdash/ui styling interfaces and cannot be selected by callers.'
    );
  }

  for (const nestedValue of Array.isArray(value) ? value : Object.values(value)) {
    assertLayerIsInfrastructureOwned(nestedValue);
  }
}

export function inLayer(input: AuthoringStyleInput, layerName: string): LayeredStyleInput {
  assertLayerIsInfrastructureOwned(input);

  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input.map((item) => inLayer(item, layerName)) as ComplexStyleRule;
  }

  return {
    '@layer': {
      [layerName]: input,
    },
  } as ComplexStyleRule;
}

export function createLayerStyle(input: AuthoringStyleInput, layerName: string): string {
  const layeredInput = inLayer(input, layerName);
  return typeof layeredInput === 'string' ? layeredInput : vanillaStyle(layeredInput);
}

export function createGlobalLayerStyle(
  selector: string,
  rule: AuthoringStyleRule,
  layerName: string
): void {
  globalStyle(selector, inLayer(rule, layerName) as GlobalStyleRule);
}

export function createRootedLayerAdapter(
  rootRule: AuthoringStyleRule,
  descendants: Readonly<Record<`&${string}`, AuthoringStyleRule>>,
  layerName: string
): string {
  const root = createLayerStyle(rootRule, layerName);

  for (const [selector, rule] of Object.entries(descendants)) {
    createGlobalLayerStyle(`${root}${selector.slice(1)}`, rule, layerName);
  }

  return root;
}
