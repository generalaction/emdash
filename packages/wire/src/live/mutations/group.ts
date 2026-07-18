import type {
  LiveStateData,
  LiveModelMutationCtx,
  LiveModelKey,
  LiveModelStates,
  LiveModelDef,
} from '../../api/define';
import type { LiveCursor, LiveCursorEntry } from '../protocol';
import type { Mutator } from '../state';
import { LiveState } from '../state';
import { stableStringify } from './registry';

export type LiveModelInitialState<Group extends LiveModelDef> = {
  [Name in keyof LiveModelStates<Group>]: LiveStateData<LiveModelStates<Group>[Name]>;
};

export type LiveModelStateServers<Group extends LiveModelDef> = {
  [Name in keyof LiveModelStates<Group>]: LiveState<LiveStateData<LiveModelStates<Group>[Name]>>;
};

export type LiveModelInstance<Group extends LiveModelDef = LiveModelDef> = {
  group: Group;
  key: LiveModelKey<Group>;
  states: LiveModelStateServers<Group>;
};

export function createGroupInstance<Group extends LiveModelDef>(
  group: Group,
  key: LiveModelKey<Group>,
  initialState: LiveModelInitialState<Group>,
  options: { generation?: number } = {}
): LiveModelInstance<Group> {
  const states: Record<string, LiveState<unknown>> = {};
  for (const name of Object.keys(group.states)) {
    states[name] = new LiveState(
      structuredClone((initialState as Record<string, unknown>)[name]),
      options.generation
    );
  }
  return { group, key, states: states as LiveModelStateServers<Group> };
}

export class LiveModelMutationContext<
  Group extends LiveModelDef = LiveModelDef,
> implements LiveModelMutationCtx<Group> {
  private readonly captured = new Map<string, LiveCursorEntry>();

  constructor(
    private readonly group: Group,
    readonly key: LiveModelKey<Group>,
    private readonly instance: LiveModelInstance<Group>,
    readonly mutationId: string
  ) {}

  produce<Name extends keyof LiveModelStates<Group>>(
    name: Name,
    mutator: Mutator<LiveStateData<LiveModelStates<Group>[Name]>>
  ): void {
    const server = this.instance.states[name];
    const ref = (this.group.states as LiveModelStates<Group>)[name];
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

function compareCursor(left: LiveCursor, right: LiveCursor): number {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return left.sequence - right.sequence;
}
