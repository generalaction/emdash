import { describe, expect, it } from 'vitest';
import { InputSequenceGate } from './sequence-gate';

describe('InputSequenceGate', () => {
  it('writes unsequenced input every time', () => {
    const gate = new InputSequenceGate();
    const pty = {};
    expect(gate.admit(pty, undefined)).toBe('write');
    expect(gate.admit(pty, undefined)).toBe('write');
  });

  it('acknowledges a replay of input it already wrote without writing it again', () => {
    const gate = new InputSequenceGate();
    const pty = {};
    expect(gate.admit(pty, { writer: 'w', seq: 0 })).toBe('write');
    expect(gate.admit(pty, { writer: 'w', seq: 0, replay: true })).toBe('duplicate');
    expect(gate.admit(pty, { writer: 'w', seq: 1, replay: true })).toBe('write');
    expect(gate.admit(pty, { writer: 'w', seq: 1, replay: true })).toBe('duplicate');
  });

  it('refuses replays into an incarnation that never saw the writer', () => {
    const gate = new InputSequenceGate();
    const replaced = {};
    gate.admit({}, { writer: 'w', seq: 0 });
    expect(gate.admit(replaced, { writer: 'w', seq: 1, replay: true })).toBe('unconfirmed');
    expect(new InputSequenceGate().admit({}, { writer: 'w', seq: 1, replay: true })).toBe(
      'unconfirmed'
    );
  });

  it('tracks writers and incarnations independently', () => {
    const gate = new InputSequenceGate();
    const first = {};
    const second = {};
    expect(gate.admit(first, { writer: 'a', seq: 5 })).toBe('write');
    expect(gate.admit(first, { writer: 'b', seq: 0 })).toBe('write');
    expect(gate.admit(second, { writer: 'a', seq: 0 })).toBe('write');
    expect(gate.admit(first, { writer: 'a', seq: 5 })).toBe('duplicate');
  });
});
