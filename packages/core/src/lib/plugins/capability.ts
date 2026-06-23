import type z from 'zod';

/**
 * Define a plugin capability: a stable id, a Zod schema for the declarative
 * descriptor, and an optional behavior contract carried as a phantom type.
 *
 * Curried so the behavior type can be supplied explicitly while the id and
 * schema types are inferred from the arguments:
 *
 *   const hooksCapability = definePluginCapability<IHooksBehavior>()('hooks', schema);
 *   const autoApprove = definePluginCapability()('auto-approve', schema); // no behavior
 *
 * An optional third argument supplies a default descriptor value. Capabilities
 * with a default become optional in definePlugin — plugins may omit them and the
 * default is filled in at definition time so all downstream consumers still see a
 * fully-populated capabilities object:
 *
 *   const effortCapability = definePluginCapability()('effort', schema, { kind: 'none' });
 */
export function definePluginCapability<TBehavior = never>() {
  return <
    TId extends string,
    TSchema extends z.ZodType,
    TDefault extends z.input<TSchema> | undefined = undefined,
  >(
    id: TId,
    descriptorSchema: TSchema,
    defaultDescriptor?: TDefault
  ) => ({
    id,
    descriptorSchema,
    defaultDescriptor,
    _descriptor: undefined as z.output<TSchema>,
    _behavior: undefined as unknown as TBehavior,
    _hasDefault: (defaultDescriptor !== undefined) as [TDefault] extends [undefined] ? false : true,
  });
}

/** Structural shape of any capability produced by definePluginCapability. */
export type AnyPluginCapability = {
  id: string;
  descriptorSchema: z.ZodType;
  defaultDescriptor?: unknown;
  _descriptor: unknown;
  _behavior: unknown;
  _hasDefault: boolean;
};

export type CapabilityMap = Record<string, AnyPluginCapability>;

export type InferPluginDescriptorType<TCapability> = TCapability extends {
  _descriptor: infer TDescriptor;
}
  ? TDescriptor
  : never;

export type InferPluginBehaviorType<TCapability> = TCapability extends {
  _behavior: infer TBehavior;
}
  ? TBehavior
  : never;

type DefaultedKeys<TCaps extends CapabilityMap> = {
  [K in keyof TCaps]: TCaps[K]['_hasDefault'] extends true ? K : never;
}[keyof TCaps];

type RequiredKeys<TCaps extends CapabilityMap> = Exclude<keyof TCaps, DefaultedKeys<TCaps>>;

/**
 * What definePlugin accepts: required capabilities must be present; defaulted
 * capabilities (those declared with a defaultDescriptor) are optional.
 */
export type CapabilityDescriptors<TCaps extends CapabilityMap> = {
  [K in RequiredKeys<TCaps>]: TCaps[K]['_descriptor'];
} & {
  [K in DefaultedKeys<TCaps>]?: TCaps[K]['_descriptor'];
};

/** All capability slots after defaults are resolved — always fully populated. */
export type ResolvedCapabilityDescriptors<TCaps extends CapabilityMap> = {
  [K in keyof TCaps]: TCaps[K]['_descriptor'];
};

/**
 * What registerPluginBehavior accepts: only capabilities that declare a
 * behavior type. The `[...] extends [never]` tuple wrap prevents distribution
 * so behavior-less capabilities are dropped from the key set entirely.
 */
export type CapabilityBehaviors<TCaps extends CapabilityMap> = {
  [K in keyof TCaps as [TCaps[K]['_behavior']] extends [never] ? never : K]?: TCaps[K]['_behavior'];
};
