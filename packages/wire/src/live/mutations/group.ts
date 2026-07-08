import type { Unsubscribe } from '@emdash/shared';
import type {
  EndpointLiveModelData,
  GroupMutationCtx,
  GroupKey,
  GroupModels,
  LiveModelGroupDef,
} from '../../api/define';
import type { Mutator } from '../model';
import { LiveModel } from '../model';
import type { LiveCursor, LiveCursorEntry } from '../protocol';
import { stableStringify } from './registry';

export type GroupInitialState<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupModels<Group>]: EndpointLiveModelData<GroupModels<Group>[Name]>;
};

export type GroupModelServers<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupModels<Group>]: LiveModel<EndpointLiveModelData<GroupModels<Group>[Name]>>;
};

export type LiveModelGroupInstance<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  group: Group;
  key: GroupKey<Group>;
  models: GroupModelServers<Group>;
};

export function createGroupInstance<Group extends LiveModelGroupDef>(
  group: Group,
  key: GroupKey<Group>,
  initialState: GroupInitialState<Group>,
  options: { generation?: number } = {}
): LiveModelGroupInstance<Group> {
  const models: Record<string, LiveModel<unknown>> = {};
  for (const name of Object.keys(group.models)) {
    models[name] = new LiveModel(
      structuredClone((initialState as Record<string, unknown>)[name]),
      options.generation
    );
  }
  return { group, key, models: models as GroupModelServers<Group> };
}

export class GroupMutationContext<
  Group extends LiveModelGroupDef = LiveModelGroupDef,
> implements GroupMutationCtx<Group> {
  private readonly captured = new Map<string, LiveCursorEntry>();

  constructor(
    private readonly group: Group,
    readonly key: GroupKey<Group>,
    private readonly instance: LiveModelGroupInstance<Group>,
    readonly mutationId: string
  ) {}

  produce<Name extends keyof GroupModels<Group>>(
    name: Name,
    mutator: Mutator<EndpointLiveModelData<GroupModels<Group>[Name]>>
  ): void {
    const server = this.instance.models[name];
    const ref = (this.group.models as GroupModels<Group>)[name];
    if (!server || !ref) return;
    const cursor = server.produce(mutator, { mutationIds: [this.mutationId] });
    this.capture(ref.id, cursor);
  }

  cursors(): LiveCursorEntry[] {
    return [...this.captured.values()];
  }

  private capture(model: string, cursor: LiveCursor): void {
    const captureKey = `${model}:${stableStringify(this.key)}`;
    const current = this.captured.get(captureKey);
    if (current && compareCursor(current.cursor, cursor) >= 0) return;
    this.captured.set(captureKey, {
      model,
      key: this.key,
      cursor,
    });
  }
}

export function combineUnsubscribes(unsubscribes: Unsubscribe[]): Unsubscribe {
  return () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  };
}

function compareCursor(left: LiveCursor, right: LiveCursor): number {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return left.sequence - right.sequence;
}
