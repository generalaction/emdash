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
 */
export function definePluginCapability<TBehavior = never>() {
  return <TId extends string, TSchema extends z.ZodType>(id: TId, descriptorSchema: TSchema) => ({
    id,
    descriptorSchema,
    _descriptor: undefined as z.output<TSchema>,
    _behavior: undefined as unknown as TBehavior,
  });
}

/** Structural shape of any capability produced by definePluginCapability. */
export type AnyPluginCapability = {
  id: string;
  descriptorSchema: z.ZodType;
  _descriptor: unknown;
  _behavior: unknown;
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

/** What definePlugin accepts: every capability slot, declaratively. */
export type CapabilityDescriptors<TCaps extends CapabilityMap> = {
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
