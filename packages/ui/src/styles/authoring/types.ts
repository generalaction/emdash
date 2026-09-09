import type { StyleRule as VanillaStyleRule } from '@vanilla-extract/css';

export type AuthoringStyleRule = Omit<VanillaStyleRule, '@layer'> & {
  readonly '@layer'?: never;
};

export type AuthoringStyleInput = AuthoringStyleRule | string | readonly AuthoringStyleInput[];
