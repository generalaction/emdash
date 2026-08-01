import { claimsCollide } from '../api/admission';
import type { ConflictPolicy } from '../api/conflict-policy';
import type { AnyOperationDefinition, InputOf } from '../api/definition';

export interface RepresentativeOperationInput<
  D extends AnyOperationDefinition = AnyOperationDefinition,
> {
  definition: D;
  input: InputOf<D>;
}

export interface CompletenessLintError {
  incoming: string;
  existing: string;
  reason: 'missing-conflict-policy';
}

export function lintConflictPolicyCompleteness(
  samples: readonly RepresentativeOperationInput[],
  policy: ConflictPolicy
): CompletenessLintError[] {
  const errors: CompletenessLintError[] = [];

  for (const incoming of samples) {
    for (const existing of samples) {
      const incomingClaims = incoming.definition.claims(incoming.input);
      const existingClaims = existing.definition.claims(existing.input);
      if (!claimsCollide(incomingClaims, existingClaims)) {
        continue;
      }
      if (incoming.definition.key(incoming.input) === existing.definition.key(existing.input)) {
        continue;
      }
      if (!policy.hasExplicit(incoming.definition.name, existing.definition.name)) {
        errors.push({
          incoming: incoming.definition.name,
          existing: existing.definition.name,
          reason: 'missing-conflict-policy',
        });
      }
    }
  }

  return errors;
}
