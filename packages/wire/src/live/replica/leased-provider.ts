import type { PendingLease } from '@emdash/shared';
import type {
  LiveModelKey,
  LiveModelMutations,
  LiveModelDef,
  LiveModelStates,
  MutationData,
  MutationError,
} from '../../api/define';
import type { LiveMutationResult } from '../mutations';
import type { LiveSource } from '../protocol';
import type { GroupMutationEnvelope } from './provider';

export type LeasedLiveModelProvider<Group extends LiveModelDef = LiveModelDef> = {
  readonly kind: 'leasedLiveModelProvider';
  readonly contract: Group;
  acquireState<Name extends Extract<keyof LiveModelStates<Group>, string>>(
    key: LiveModelKey<Group>,
    name: Name
  ): PendingLease<LiveSource>;
  runMutation<Name extends Extract<keyof LiveModelMutations<Group>, string>>(
    name: Name,
    envelope: GroupMutationEnvelope<Group, Name>
  ): Promise<
    LiveMutationResult<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  >;
  dispose(): Promise<void>;
};

export function isLeasedLiveModelProvider(value: unknown): value is LeasedLiveModelProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'leasedLiveModelProvider'
  );
}
