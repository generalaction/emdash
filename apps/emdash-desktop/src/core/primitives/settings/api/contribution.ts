import type { ZodType } from 'zod';

export type SettingsContribution<K extends string, T> = Readonly<{
  key: K;
  schema: ZodType<T>;
  defaults: T | (() => T);
}>;

export type SettingsContributionMap<TSettings extends object> = {
  readonly [K in keyof TSettings]: SettingsContribution<K & string, TSettings[K]>;
};

export type SettingsValueOf<TContribution> =
  TContribution extends SettingsContribution<string, infer TValue> ? TValue : never;

export type SettingsValues<TContributions extends Record<string, unknown>> = {
  readonly [K in keyof TContributions]: SettingsValueOf<TContributions[K]>;
};

export function defineSettingsContribution<K extends string, T>(
  contribution: SettingsContribution<K, T>
): SettingsContribution<K, T> {
  return Object.freeze(contribution);
}
