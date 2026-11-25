import type { InputSequence } from './schemas';

export type InputAdmission = 'write' | 'duplicate' | 'unconfirmed';

/**
 * Writes each writer's input at most once per PTY incarnation. A replay is written only when this
 * incarnation has already seen the writer: after a runtime restart or a replacement PTY the gate
 * cannot know whether the key was written, so it reports the input unconfirmed instead.
 */
export class InputSequenceGate {
  private readonly lastSeq = new WeakMap<object, Map<string, number>>();

  admit(incarnation: object, sequence: InputSequence | undefined): InputAdmission {
    if (!sequence) return 'write';
    const writers = this.lastSeq.get(incarnation) ?? new Map<string, number>();
    const last = writers.get(sequence.writer);
    if (sequence.replay && last === undefined) return 'unconfirmed';
    if (last !== undefined && sequence.seq <= last) return 'duplicate';
    writers.set(sequence.writer, sequence.seq);
    this.lastSeq.set(incarnation, writers);
    return 'write';
  }
}
