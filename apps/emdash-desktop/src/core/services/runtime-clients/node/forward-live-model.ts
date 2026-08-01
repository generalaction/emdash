import type { LiveModelProvider } from '@emdash/wire';
import type { LiveModelDef } from '@emdash/wire/api';

export function forwardLiveModel<Group extends LiveModelDef>(
  contract: Group,
  resolveState: LiveModelProvider<Group>['resolveState'],
  options: { readonly mutationMessage?: string } = {}
): LiveModelProvider<Group> {
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState,
    async runMutation() {
      throw new Error(options.mutationMessage ?? `Live model '${contract.id}' has no mutations`);
    },
  };
}
