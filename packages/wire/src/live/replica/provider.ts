import type {
  LiveModelKey,
  LiveModelMutations,
  LiveModelDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import type { LiveMutationResult } from '../mutations';
import type { LiveSource } from '../protocol';

export type GroupMutationEnvelope<
  Group extends LiveModelDef,
  Name extends keyof LiveModelMutations<Group>,
> = {
  key: LiveModelKey<Group>;
  input: MutationInput<LiveModelMutations<Group>[Name]>;
  mutationId: string;
};

export type LiveModelProvider<Group extends LiveModelDef = LiveModelDef> = {
  readonly kind: 'liveModelProvider';
  readonly contract: Group;
  resolveState<Name extends Extract<keyof Group['states'], string>>(
    key: LiveModelKey<Group>,
    name: Name
  ): LiveSource | Promise<LiveSource | null | undefined> | null | undefined;
  runMutation<Name extends Extract<keyof LiveModelMutations<Group>, string>>(
    name: Name,
    envelope: GroupMutationEnvelope<Group, Name>
  ): Promise<
    LiveMutationResult<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  >;
};

export function isLiveModelProvider(value: unknown): value is LiveModelProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveModelProvider'
  );
}
