import { isErr, isOk } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import type { AcpPermissionRequest } from './models/permissions';
import type { SessionMachineState } from './session-machine';
import {
  activeTurnFromPhase,
  decide,
  evolve,
  initialMachineState,
  phaseToLifecycle,
  SessionMachine,
} from './session-machine';

const CONV_ID = 'conv-test';
const prompt = { id: 'prompt-1', text: 'hello' };

function makeReady(): SessionMachineState {
  return evolve(initialMachineState(CONV_ID), { type: 'SessionReady' }).state;
}

function makeWorking(): SessionMachineState {
  const ready = makeReady();
  const result = decide(ready, { type: 'Prompt', prompt });
  if (!isOk(result)) throw new Error('decide Prompt failed');
  return evolve(ready, result.data[0]).state;
}

const permRequest: AcpPermissionRequest = {
  requestId: 'req-1',
  title: 'Read a file',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
};

describe('initialMachineState', () => {
  it('starts in "starting" phase', () => {
    const s = initialMachineState(CONV_ID);
    expect(phaseToLifecycle(s.phase)).toBe('starting');
    expect(s.pendingPermissions).toHaveLength(0);
  });
});

describe('decide Prompt', () => {
  it('accepted when ready', () => {
    const result = decide(makeReady(), { type: 'Prompt', prompt });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toEqual([{ type: 'PromptStarted', prompt }]);
  });

  it('queues while a turn is already in flight', () => {
    const result = decide(makeWorking(), { type: 'Prompt', prompt });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toEqual([{ type: 'PromptQueued', prompt }]);
  });
});

describe('lifecycle control', () => {
  it('starting -> replaying -> ready', () => {
    const s0 = initialMachineState(CONV_ID);
    const { state: s1 } = evolve(s0, { type: 'ReplayStarted' });
    expect(phaseToLifecycle(s1.phase)).toBe('replaying');
    expect(activeTurnFromPhase(s1.phase)?.id).toBe('turn-conv-test-0');

    const { state: s2 } = evolve(s1, { type: 'ReplayEnded', status: 'complete' });
    expect(phaseToLifecycle(s2.phase)).toBe('ready');
    expect(activeTurnFromPhase(s2.phase)).toBeNull();
  });

  it('ready -> working -> ready and preserves stop reason', () => {
    const s0 = makeReady();
    const { state: s1, effects } = evolve(s0, { type: 'PromptStarted', prompt });
    expect(phaseToLifecycle(s1.phase)).toBe('working');
    expect(activeTurnFromPhase(s1.phase)?.id).toBe('turn-conv-test-0');
    expect(effects.some((e) => e.type === 'agentEvent' && e.phase === 'start')).toBe(true);

    const { state: s2 } = evolve(s1, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'end_turn' },
    });
    expect(phaseToLifecycle(s2.phase)).toBe('ready');
    expect(s2.lastStopReason).toBe('end_turn');
  });

  it('drains one queued prompt when a turn ends', () => {
    const queued = { id: 'prompt-2', text: 'queued' };
    const s0 = evolve(makeWorking(), { type: 'PromptQueued', prompt: queued }).state;
    const { state, effects } = evolve(s0, {
      type: 'TurnEnded',
      outcome: { kind: 'stopped', stopReason: 'end_turn' },
    });

    expect(state.queuedPrompts).toHaveLength(0);
    expect(effects).toContainEqual({ type: 'sendPrompt', prompt: queued });
  });

  it('tracks agent activity and background agent counts', () => {
    const active = evolve(makeReady(), { type: 'AgentActivity', active: true }).state;
    expect(active.agentTurnActive).toBe(true);

    const counted = evolve(active, { type: 'AgentsChanged', runningCount: 2 }).state;
    expect(counted.backgroundAgentCount).toBe(2);
  });

  it('cancel drains pending permissions', () => {
    let s = makeWorking();
    s = evolve(s, { type: 'PermissionRequested', request: permRequest }).state;
    const { state, effects } = evolve(s, { type: 'CancellationRequested' });
    expect(phaseToLifecycle(state.phase)).toBe('cancelling');
    expect(state.pendingPermissions).toHaveLength(0);
    expect(effects).toContainEqual({
      type: 'permissionResolved',
      requestId: 'req-1',
      cancelled: true,
    });
  });
});

describe('permissions and metadata', () => {
  it('guards ResolvePermission against unknown ids', () => {
    const result = decide(makeWorking(), {
      type: 'ResolvePermission',
      requestId: 'unknown',
      optionId: null,
    });
    expect(isErr(result)).toBe(true);
  });

  it('accepts ResolvePermission for pending requests', () => {
    const s = evolve(makeWorking(), { type: 'PermissionRequested', request: permRequest }).state;
    const result = decide(s, { type: 'ResolvePermission', requestId: 'req-1', optionId: 'allow' });
    expect(isOk(result)).toBe(true);
  });

  it('applies control-plane metadata changes', () => {
    const { state } = evolve(makeReady(), {
      type: 'MetaChanged',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'default',
          options: [],
        },
      ],
    });
    expect(state.configOptions).toHaveLength(1);
  });
});

describe('SessionMachine wrapper', () => {
  it('derives affordances from control state', () => {
    const machine = new SessionMachine(CONV_ID);
    machine.apply({ type: 'SessionReady' });
    expect(machine.canSubmit).toBe(true);
    expect(machine.canCancel).toBe(false);

    const result = machine.dispatch({ type: 'Prompt', prompt });
    expect(isOk(result)).toBe(true);
    expect(machine.canSubmit).toBe(false);
    expect(machine.canCancel).toBe(true);
    expect(machine.sessionState().activeTurnId).toBe('turn-conv-test-0');
  });
});
