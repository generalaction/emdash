import type { LiveModelProvider } from '@emdash/wire';
import type { LiveModelDef } from '@emdash/wire/api';

/**
 * Forwards a live-model contract to an upstream runtime's model, resolving the upstream
 * live source per key (host/workspace lookup happens inside `resolveState`, typically via
 * a contract client's `.state(key, name).asLiveSource()`).
 *
 * This is contract forwarding over the client-handle channel, not state authoring: no
 * state is owned here, and upstream snapshots and updates pass through untouched. The
 * `cell` + `expose` authoring mandate (wire-architecture state-system endgame) covers
 * hand-authored state models only — do not copy this shape to author one.
 */
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
