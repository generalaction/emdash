import { isErr, isOk } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import type { AgentUpdate } from './agent-update';
import type { AcpPermissionRequest } from './permissions';
import type { SessionMachineState } from './session-machine';
import {
  decide,
  evolve,
  initialMachineState,
  activeTurnFromPhase,
  phaseToLifecycle,
} from './session-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONV_ID = 'conv-test';

function makeReady(): SessionMachineState {
  const s0 = initialMachineState(CONV_ID);
  const { state } = evolve(s0, { type: 'SessionReady' });
  return state;
}

function makeWorking(): SessionMachineState {
  const ready = makeReady();
  const userUpdate: AgentUpdate = { kind: 'message', role: 'user', messageId: null, text: 'hello' };
  const events = decide(ready, { type: 'Prompt', userUpdate });
  if (!isOk(events)) throw new Error('decide Prompt failed');
  let s = ready;
  for (const ev of events.data) {
    ({ state: s } = evolve(s, ev));
  }
  return s;
}

function makeCancelling(): SessionMachineState {
  const working = makeWorking();
  const events = decide(working, { type: 'Cancel' });
  if (!isOk(events)) throw new Error('decide Cancel failed');
  let s = working;
  for (const ev of events.data) {
    ({ state: s } = evolve(s, ev));
  }
  return s;
}

const userMsg: AgentUpdate = { kind: 'message', role: 'user', messageId: null, text: 'hi' };
const agentMsg: AgentUpdate = { kind: 'message', role: 'assistant', messageId: null, text: 'ok' };

const permRequest: AcpPermissionRequest = {
  conversationId: CONV_ID,
  requestId: 'req-1',
  title: 'Read a file',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
};

// ---------------------------------------------------------------------------
// initialMachineState
// ---------------------------------------------------------------------------

describe('initialMachineState', () => {
  it('starts in "starting" phase', () => {
    const s = initialMachineState(CONV_ID);
    expect(phaseToLifecycle(s.phase)).toBe('starting');
    expect(s.committedTurns).toHaveLength(0);
    expect(s.pendingPermissions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decide — Prompt
// ---------------------------------------------------------------------------

describe('decide Prompt', () => {
  it('accepted when ready', () => {
    const s = makeReady();
    const result = decide(s, { type: 'Prompt', userUpdate: userMsg });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].type).toBe('PromptStarted');
  });

  it('rejected when starting', () => {
    const s = initialMachineState(CONV_ID);
    const result = decide(s, { type: 'Prompt', userUpdate: userMsg });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('invalid_state');
  });

  it('rejected when working (double-prompt guard)', () => {
    const s = makeWorking();
    const result = decide(s, { type: 'Prompt', userUpdate: userMsg });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('invalid_state');
  });

  it('rejected when cancelling', () => {
    const s = makeCancelling();
    const result = decide(s, { type: 'Prompt', userUpdate: userMsg });
    expect(isErr(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decide — Cancel
// ---------------------------------------------------------------------------

describe('decide Cancel', () => {
  it('accepted (produces CancellationRequested) when working', () => {
    const s = makeWorking();
    const result = decide(s, { type: 'Cancel' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].type).toBe('CancellationRequested');
  });

  it('idempotent (empty events) when ready', () => {
    const s = makeReady();
    const result = decide(s, { type: 'Cancel' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toHaveLength(0);
  });

  it('idempotent when already cancelling', () => {
    const s = makeCancelling();
    const result = decide(s, { type: 'Cancel' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decide — ResolvePermission
// ---------------------------------------------------------------------------

describe('decide ResolvePermission', () => {
  it('accepted when requestId is in queue', () => {
    let s = makeWorking();
    ({ state: s } = evolve(s, { type: 'PermissionRequested', request: permRequest }));
    const result = decide(s, { type: 'ResolvePermission', requestId: 'req-1', optionId: 'allow' });
    expect(isOk(result)).toBe(true);
  });

  it('rejected for unknown requestId', () => {
    const s = makeWorking();
    const result = decide(s, { type: 'ResolvePermission', requestId: 'unknown', optionId: null });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('invalid_state');
  });
});

// ---------------------------------------------------------------------------
// decide — SetMode
// ---------------------------------------------------------------------------

describe('decide SetMode', () => {
  it('rejected when modes is null', () => {
    const s = makeReady();
    const result = decide(s, { type: 'SetMode', modeId: 'ask' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('invalid_state');
  });

  it('rejected for unavailable mode', () => {
    let s = makeReady();
    ({ state: s } = evolve(s, {
      type: 'MetaChanged',
      modes: { availableModes: [{ id: 'code', name: 'Code' }], currentModeId: 'code' },
    }));
    const result = decide(s, { type: 'SetMode', modeId: 'ask' });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.type).toBe('set_mode_failed');
  });

  it('accepted for available mode', () => {
    let s = makeReady();
    ({ state: s } = evolve(s, {
      type: 'MetaChanged',
      modes: {
        availableModes: [
          { id: 'ask', name: 'Ask' },
          { id: 'code', name: 'Code' },
        ],
        currentModeId: 'code',
      },
    }));
    const result = decide(s, { type: 'SetMode', modeId: 'ask' });
    expect(isOk(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evolve — lifecycle transitions
// ---------------------------------------------------------------------------

describe('evolve — startup', () => {
  it('starting → replaying via ReplayStarted', () => {
    const s0 = initialMachineState(CONV_ID);
    const { state } = evolve(s0, { type: 'ReplayStarted' });
    expect(phaseToLifecycle(state.phase)).toBe('replaying');
    expect(activeTurnFromPhase(state.phase)).not.toBeNull();
  });

  it('starting → ready via SessionReady', () => {
    const s0 = initialMachineState(CONV_ID);
    const { state } = evolve(s0, { type: 'SessionReady' });
    expect(phaseToLifecycle(state.phase)).toBe('ready');
  });

  it('replaying → ready via ReplayEnded', () => {
    const s0 = initialMachineState(CONV_ID);
    const { state: s1 } = evolve(s0, { type: 'ReplayStarted' });
    const { state: s2 } = evolve(s1, { type: 'ReplayEnded', status: 'complete' });
    expect(phaseToLifecycle(s2.phase)).toBe('ready');
    expect(s2.committedTurns).toHaveLength(1);
    expect(s2.committedTurns[0].source).toBe('replay');
  });
});

describe('evolve — working lifecycle', () => {
  it('ready → working via PromptStarted, then → ready via TurnEnded', () => {
    const s0 = makeReady();
    const { state: s1 } = evolve(s0, { type: 'PromptStarted', userUpdate: userMsg });
    expect(phaseToLifecycle(s1.phase)).toBe('working');
    expect(activeTurnFromPhase(s1.phase)).not.toBeNull();

    const { state: s2 } = evolve(s1, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'end_turn' },
    });
    expect(phaseToLifecycle(s2.phase)).toBe('ready');
    expect(s2.committedTurns).toHaveLength(1);
    expect(s2.committedTurns[0].status).toBe('complete');
    expect(s2.committedTurns[0].stopReason).toBe('end_turn');
    expect(s2.lastStopReason).toBe('end_turn');
  });

  it('TurnEnded(errored) produces error status', () => {
    const s0 = makeWorking();
    const { state } = evolve(s0, { type: 'TurnEnded', outcome: { kind: 'errored' } });
    expect(phaseToLifecycle(state.phase)).toBe('ready');
    expect(state.committedTurns[0].status).toBe('error');
    expect(state.committedTurns[0].stopReason).toBeNull();
    expect(state.lastStopReason).toBeNull();
  });

  it('TurnEnded(cancelled) produces cancelled status', () => {
    const s0 = makeWorking();
    const { state } = evolve(s0, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'cancelled' },
    });
    expect(state.committedTurns[0].status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// evolve — Updated does NOT change lifecycle
// ---------------------------------------------------------------------------

describe('evolve Updated', () => {
  it('Updated while working does not change lifecycle', () => {
    const s0 = makeWorking();
    const { state } = evolve(s0, { type: 'Updated', update: agentMsg });
    expect(phaseToLifecycle(state.phase)).toBe('working');
  });

  it('Updated while ready emits a warn effect', () => {
    const s0 = makeReady();
    const { state, effects } = evolve(s0, { type: 'Updated', update: agentMsg });
    expect(phaseToLifecycle(state.phase)).toBe('ready'); // unchanged
    expect(effects.some((e) => e.type === 'warn')).toBe(true);
  });

  it('Updated appends to turn updates and advances seq', () => {
    const s0 = makeWorking();
    const seqBefore = s0.nextSeq;
    const { state } = evolve(s0, { type: 'Updated', update: agentMsg });
    const turn = activeTurnFromPhase(state.phase)!;
    // First update is the synthesized user message, second is the agent update
    expect(turn.updates).toHaveLength(2);
    expect(state.nextSeq).toBe(seqBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// evolve — cancel path
// ---------------------------------------------------------------------------

describe('evolve cancel path', () => {
  it('CancellationRequested → cancelling and drains permissions', () => {
    let s = makeWorking();
    ({ state: s } = evolve(s, { type: 'PermissionRequested', request: permRequest }));
    expect(s.pendingPermissions).toHaveLength(1);

    const { state: s2, effects } = evolve(s, { type: 'CancellationRequested' });
    expect(phaseToLifecycle(s2.phase)).toBe('cancelling');
    expect(s2.pendingPermissions).toHaveLength(0);
    // Should emit one permissionResolved effect per drained permission
    const resolvedEffects = effects.filter((e) => e.type === 'permissionResolved');
    expect(resolvedEffects).toHaveLength(1);
    if (resolvedEffects[0].type === 'permissionResolved') {
      expect(resolvedEffects[0].cancelled).toBe(true);
    }
  });

  it('TurnEnded after cancelling returns to ready', () => {
    const s0 = makeCancelling();
    const { state } = evolve(s0, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'cancelled' },
    });
    expect(phaseToLifecycle(state.phase)).toBe('ready');
  });

  it('CancellationRequested outside working emits warn', () => {
    const s0 = makeReady();
    const { effects } = evolve(s0, { type: 'CancellationRequested' });
    expect(effects.some((e) => e.type === 'warn')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evolve — MetaChanged accepted in ready and working
// ---------------------------------------------------------------------------

describe('evolve MetaChanged', () => {
  it('updates modes and configOptions when ready', () => {
    const s0 = makeReady();
    const modes = { availableModes: [{ id: 'ask', name: 'Ask' }], currentModeId: 'ask' };
    const { state } = evolve(s0, { type: 'MetaChanged', modes });
    expect(state.modes).toEqual(modes);
    expect(phaseToLifecycle(state.phase)).toBe('ready');
  });

  it('updates modes and configOptions when working (does not disturb turn)', () => {
    const s0 = makeWorking();
    const modes = { availableModes: [{ id: 'code', name: 'Code' }], currentModeId: 'code' };
    const { state } = evolve(s0, { type: 'MetaChanged', modes });
    expect(state.modes).toEqual(modes);
    expect(phaseToLifecycle(state.phase)).toBe('working');
    expect(activeTurnFromPhase(state.phase)).not.toBeNull();
  });

  it('partial update leaves untouched fields unchanged', () => {
    let s = makeReady();
    const commands = [{ name: '/create-plan', description: 'Create a plan' }];
    ({ state: s } = evolve(s, { type: 'MetaChanged', availableCommands: commands }));
    expect(s.availableCommands).toEqual(commands);
    expect(s.modes).toBeNull(); // untouched
  });
});

// ---------------------------------------------------------------------------
// evolve — ProcessClosed
// ---------------------------------------------------------------------------

describe('evolve ProcessClosed', () => {
  it('transitions to closed with exitCode', () => {
    const s0 = makeReady();
    const { state } = evolve(s0, { type: 'ProcessClosed', exitCode: 1 });
    expect(phaseToLifecycle(state.phase)).toBe('closed');
    if (state.phase.kind === 'closed') {
      expect(state.phase.exitCode).toBe(1);
    }
  });

  it('commits active turn as error when process closes while working', () => {
    const s0 = makeWorking();
    const { state, effects } = evolve(s0, { type: 'ProcessClosed', exitCode: null });
    expect(phaseToLifecycle(state.phase)).toBe('closed');
    expect(state.committedTurns).toHaveLength(1);
    expect(state.committedTurns[0].status).toBe('error');
    expect(effects.some((e) => e.type === 'turnCommitted')).toBe(true);
  });

  it('drains permissions when process closes while working with pending permissions', () => {
    let s = makeWorking();
    ({ state: s } = evolve(s, { type: 'PermissionRequested', request: permRequest }));
    const { state: s2, effects } = evolve(s, { type: 'ProcessClosed', exitCode: null });
    expect(s2.pendingPermissions).toHaveLength(0);
    const resolved = effects.filter((e) => e.type === 'permissionResolved');
    expect(resolved).toHaveLength(1);
  });

  it('emits closed effect', () => {
    const s0 = makeReady();
    const { effects } = evolve(s0, { type: 'ProcessClosed', exitCode: 0 });
    const closedEffect = effects.find((e) => e.type === 'closed');
    expect(closedEffect).toBeDefined();
    if (closedEffect?.type === 'closed') {
      expect(closedEffect.exitCode).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// evolve — PermissionRequested / PermissionResolved
// ---------------------------------------------------------------------------

describe('evolve permissions', () => {
  it('PermissionRequested adds to queue', () => {
    const s0 = makeWorking();
    const { state } = evolve(s0, { type: 'PermissionRequested', request: permRequest });
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0].requestId).toBe('req-1');
  });

  it('PermissionResolved removes from queue', () => {
    let s = makeWorking();
    ({ state: s } = evolve(s, { type: 'PermissionRequested', request: permRequest }));
    ({ state: s } = evolve(s, { type: 'PermissionResolved', requestId: 'req-1' }));
    expect(s.pendingPermissions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// evolve — turn id stability
// ---------------------------------------------------------------------------

describe('turn id stability', () => {
  it('turn ids are deterministic from conversationId and index', () => {
    const s0 = makeReady();
    const { state: s1 } = evolve(s0, { type: 'PromptStarted', userUpdate: userMsg });
    const turn1 = activeTurnFromPhase(s1.phase)!;
    expect(turn1.id).toBe(`turn-${CONV_ID}-0`);

    const { state: s2 } = evolve(s1, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'end_turn' },
    });
    const { state: s3 } = evolve(s2, { type: 'PromptStarted', userUpdate: userMsg });
    const turn2 = activeTurnFromPhase(s3.phase)!;
    expect(turn2.id).toBe(`turn-${CONV_ID}-1`);
  });
});

// ---------------------------------------------------------------------------
// evolve — effects
// ---------------------------------------------------------------------------

describe('effects', () => {
  it('PromptStarted emits state, update, and agentEvent(start)', () => {
    const s0 = makeReady();
    const { effects } = evolve(s0, { type: 'PromptStarted', userUpdate: userMsg });
    expect(effects.some((e) => e.type === 'state')).toBe(true);
    expect(effects.some((e) => e.type === 'update')).toBe(true);
    expect(effects.some((e) => e.type === 'agentEvent' && e.phase === 'start')).toBe(true);
  });

  it('TurnEnded emits turnCommitted, state, and agentEvent(stop)', () => {
    const s0 = makeWorking();
    const { effects } = evolve(s0, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'end_turn' },
    });
    expect(effects.some((e) => e.type === 'turnCommitted')).toBe(true);
    expect(effects.some((e) => e.type === 'state')).toBe(true);
    expect(effects.some((e) => e.type === 'agentEvent' && e.phase === 'stop')).toBe(true);
  });

  it('TurnEnded(errored) emits agentEvent(error)', () => {
    const s0 = makeWorking();
    const { effects } = evolve(s0, { type: 'TurnEnded', outcome: { kind: 'errored' } });
    expect(effects.some((e) => e.type === 'agentEvent' && e.phase === 'error')).toBe(true);
  });
});
