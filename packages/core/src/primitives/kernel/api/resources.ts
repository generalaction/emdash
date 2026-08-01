import type { ClaimMode } from './claim-modes';

export interface ResourceClaim {
  /** Resource definition name, for display and debugging ('worktree', 'repo'). */
  resource: string;
  /** Canonical resource key — the identity claims collide on. */
  key: string;
  mode: ClaimMode;
  /** True for ancestor intents produced by claim expansion. */
  implicit: boolean;
}

export interface ResourceParentLink {
  def: AnyResourceDefinition;
  ref: unknown;
}

export interface ResourceDefinition<TName extends string, TRef> {
  readonly name: TName;
  readonly parent?: (ref: TRef) => ResourceParentLink | undefined;
  key(ref: TRef): string;
  reads(ref: TRef): ResourceClaim[];
  mutates(ref: TRef): ResourceClaim[];
  claim(ref: TRef, mode: ClaimMode): ResourceClaim[];
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyResourceDefinition = ResourceDefinition<string, any>;

export function defineResource<TName extends string, TRef>(spec: {
  name: TName;
  key: (ref: TRef) => string;
  parent?: (ref: TRef) => ResourceParentLink | undefined;
}): ResourceDefinition<TName, TRef> {
  const definition: ResourceDefinition<TName, TRef> = {
    name: spec.name,
    parent: spec.parent,
    key: spec.key,
    reads(ref) {
      return this.claim(ref, 'shared');
    },
    mutates(ref) {
      return this.claim(ref, 'exclusive');
    },
    claim(ref, mode) {
      const ancestorMode = mode === 'shared' ? 'intent-shared' : 'intent-exclusive';
      return [
        { resource: spec.name, key: spec.key(ref), mode, implicit: false },
        ...ancestorClaims(spec.parent?.(ref), ancestorMode),
      ];
    },
  };

  return Object.freeze(definition);
}

function ancestorClaims(
  parent: ResourceParentLink | undefined,
  mode: 'intent-shared' | 'intent-exclusive'
): ResourceClaim[] {
  if (!parent) {
    return [];
  }

  return [
    {
      resource: parent.def.name,
      key: parent.def.key(parent.ref),
      mode,
      implicit: true,
    },
    ...ancestorClaims(parent.def.parent?.(parent.ref), mode),
  ];
}
