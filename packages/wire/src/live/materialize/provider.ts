import type {
  GroupKey,
  GroupMutations,
  LiveModelGroupDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import type { LiveMutationResult } from '../mutations';
import type { LiveSource } from '../protocol';

export type GroupMutationEnvelope<
  Group extends LiveModelGroupDef,
  Name extends keyof GroupMutations<Group>,
> = {
  key: GroupKey<Group>;
  input: MutationInput<GroupMutations<Group>[Name]>;
  mutationId: string;
};

export type LiveModelGroupProvider<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  readonly kind: 'liveModelGroupProvider';
  readonly contract: Group;
  resolveModel<Name extends Extract<keyof Group['models'], string>>(
    key: GroupKey<Group>,
    name: Name
  ): LiveSource | null | undefined;
  runMutation<Name extends Extract<keyof GroupMutations<Group>, string>>(
    name: Name,
    envelope: GroupMutationEnvelope<Group, Name>
  ): Promise<
    LiveMutationResult<
      MutationData<GroupMutations<Group>[Name]>,
      MutationError<GroupMutations<Group>[Name]>
    >
  >;
};

export function isLiveModelGroupProvider(value: unknown): value is LiveModelGroupProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveModelGroupProvider'
  );
}
