import type { Logger } from '@emdash/shared/logger';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower, type LiveFollowerApplyResult } from '../follower';
import type { LiveLogDelta, LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../protocol';

export type LiveLogClientDeps = {
  refetchSnapshot: () => Promise<LiveSnapshot<LiveLogSnapshotData>>;
  onReset: (data: LiveLogSnapshotData) => void;
  onAppend: (chunk: string) => void;
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
};

export class LiveLogClient extends LiveFollower<LiveLogSnapshotData> {
  constructor(private readonly deps: LiveLogClientDeps) {
    super(deps.refetchSnapshot, { ...deps, label: 'live log' });
  }

  protected onSeeded(data: LiveLogSnapshotData): void {
    this.deps.onReset(data);
  }

  protected applyDelta(update: LiveUpdate): LiveFollowerApplyResult<LiveLogSnapshotData> {
    const current = this.value;
    if (current === undefined) {
      return { ok: false, reason: 'sequence-gap', details: { reason: 'update-before-seed' } };
    }
    if (!isLiveLogDelta(update.delta)) {
      return { ok: false, reason: 'patch-failed', details: { reason: 'invalid-delta' } };
    }

    return {
      ok: true,
      value: {
        ...current,
        text: `${current.text}${update.delta.chunk}`,
      },
    };
  }

  protected onApplied(_value: LiveLogSnapshotData, update: LiveUpdate): void {
    if (!isLiveLogDelta(update.delta)) return;
    this.deps.onAppend(update.delta.chunk);
  }
}

function isLiveLogDelta(value: unknown): value is LiveLogDelta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'chunk' in value &&
    typeof (value as { chunk: unknown }).chunk === 'string'
  );
}
