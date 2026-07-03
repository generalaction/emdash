/**
 * Pure ACP session control-plane state machine.
 *
 * The machine owns lifecycle, permissions, metadata, stop reasons, and
 * affordances. Transcript content is projected separately by the ACP reducer.
 */

import type { SessionConfigOption, SessionModeState, StopReason } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { AcpRuntimeError } from './errors';
import { acpErr } from './errors';
import type { AcpPermissionRequest } from './models/permissions';
import type { SessionSnapshot, SessionState } from './state';

export type SessionPhase =
  | { kind: 'starting' }
  | { kind: 'replaying'; turn: ControlTurn }
  | { kind: 'ready' }
  | { kind: 'working'; turn: ControlTurn }
  | { kind: 'cancelling'; turn: ControlTurn }
  | { kind: 'closed'; exitCode: number | null };

export interface ControlTurn {
  id: string;
}

export function phaseToLifecycle(phase: SessionPhase): SessionLifecycle {
  return phase.kind;
}

export function activeTurnFromPhase(phase: SessionPhase): ControlTurn | null {
  if (phase.kind === 'replaying' || phase.kind === 'working' || phase.kind === 'cancelling') {
    return phase.turn;
  }
  return null;
}

export type SessionLifecycle =
  | 'starting'
  | 'replaying'
  | 'ready'
  | 'working'
  | 'cancelling'
  | 'closed';

export interface SessionMachineState {
  readonly conversationId: string;
  readonly phase: SessionPhase;
  readonly pendingPermissions: readonly AcpPermissionRequest[];
  readonly modes: SessionModeState | null;
  readonly configOptions: readonly SessionConfigOption[];
  readonly lastStopReason: StopReason | null;
  readonly nextTurnIndex: number;
}

export function initialMachineState(conversationId: string): SessionMachineState {
  return {
    conversationId,
    phase: { kind: 'starting' },
    pendingPermissions: [],
    modes: null,
    configOptions: [],
    lastStopReason: null,
    nextTurnIndex: 0,
  };
}

export type Command =
  | { type: 'Prompt' }
  | { type: 'Cancel' }
  | { type: 'ResolvePermission'; requestId: string; optionId: string | null }
  | { type: 'SetMode'; modeId: string }
  | { type: 'SetConfigOption'; configId: string; value: string };

export type DomainEvent =
  | { type: 'ReplayStarted' }
  | { type: 'ReplayEnded'; status: 'complete' | 'error' | 'cancelled' }
  | {
      type: 'SessionReady';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  | {
      type: 'SessionLoaded';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  | { type: 'PromptStarted' }
  | { type: 'TurnEnded'; outcome: TurnOutcome }
  | { type: 'CancellationRequested' }
  | { type: 'PermissionRequested'; request: AcpPermissionRequest }
  | { type: 'PermissionResolved'; requestId: string }
  | {
      type: 'MetaChanged';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  | { type: 'ProcessClosed'; exitCode: number | null };

export type TurnOutcome = { kind: 'stopped'; stopReason: StopReason } | { kind: 'errored' };

export type Effect =
  | { type: 'state' }
  | { type: 'permissionRequest'; request: AcpPermissionRequest }
  | { type: 'permissionResolved'; requestId: string; cancelled: boolean }
  | { type: 'meta' }
  | { type: 'closed'; exitCode: number | null }
  | { type: 'agentEvent'; phase: 'start' | 'stop' | 'error' }
  | { type: 'warn'; message: string };

export function decide(
  s: SessionMachineState,
  cmd: Command
): Result<DomainEvent[], AcpRuntimeError> {
  switch (cmd.type) {
    case 'Prompt':
      if (!isPromptReady(phaseToLifecycle(s.phase))) {
        return acpErr.invalidState(`Cannot send a prompt while session is '${s.phase.kind}'`);
      }
      return ok([{ type: 'PromptStarted' }]);

    case 'Cancel':
      if (s.phase.kind !== 'working') return ok([]);
      return ok([{ type: 'CancellationRequested' }]);

    case 'ResolvePermission':
      if (!s.pendingPermissions.some((p) => p.requestId === cmd.requestId)) {
        return acpErr.invalidState(`No pending permission request with id '${cmd.requestId}'`);
      }
      return ok([{ type: 'PermissionResolved', requestId: cmd.requestId }]);

    case 'SetMode':
      if (!s.modes) return acpErr.invalidState('Agent does not support session modes');
      if (!s.modes.availableModes.some((m) => m.id === cmd.modeId)) {
        return acpErr.setModeFailed({
          name: 'Error',
          message: `Mode '${cmd.modeId}' is not in the available modes list`,
        });
      }
      return ok([]);

    case 'SetConfigOption':
      if (!s.configOptions.some((o) => o.id === cmd.configId)) {
        return acpErr.setConfigFailed({
          name: 'Error',
          message: `Config option '${cmd.configId}' is not known`,
        });
      }
      return ok([]);
  }
}

export function evolve(
  s: SessionMachineState,
  ev: DomainEvent
): { state: SessionMachineState; effects: Effect[] } {
  switch (ev.type) {
    case 'ReplayStarted': {
      if (s.phase.kind !== 'starting') return warn(s, `ReplayStarted in phase '${s.phase.kind}'`);
      const turn = makeTurn(s);
      return {
        state: { ...s, phase: { kind: 'replaying', turn }, nextTurnIndex: s.nextTurnIndex + 1 },
        effects: [{ type: 'state' }],
      };
    }

    case 'ReplayEnded':
      if (s.phase.kind !== 'replaying') return warn(s, `ReplayEnded in phase '${s.phase.kind}'`);
      return { state: { ...s, phase: { kind: 'ready' } }, effects: [{ type: 'state' }] };

    case 'SessionReady':
      if (s.phase.kind !== 'starting') return warn(s, `SessionReady in phase '${s.phase.kind}'`);
      return {
        state: {
          ...s,
          phase: { kind: 'ready' },
          modes: ev.modes ?? s.modes,
          configOptions: ev.configOptions ?? s.configOptions,
        },
        effects: [
          { type: 'state' },
          ...(needsSetupMetaEffect(ev) ? ([{ type: 'meta' }] as Effect[]) : []),
        ],
      };

    case 'SessionLoaded':
      if (s.phase.kind !== 'replaying') return warn(s, `SessionLoaded in phase '${s.phase.kind}'`);
      return {
        state: {
          ...s,
          modes: ev.modes ?? s.modes,
          configOptions: ev.configOptions ?? s.configOptions,
        },
        effects: needsSetupMetaEffect(ev) ? [{ type: 'meta' }] : [],
      };

    case 'PromptStarted': {
      if (s.phase.kind !== 'ready') return warn(s, `PromptStarted in phase '${s.phase.kind}'`);
      const turn = makeTurn(s);
      return {
        state: { ...s, phase: { kind: 'working', turn }, nextTurnIndex: s.nextTurnIndex + 1 },
        effects: [{ type: 'state' }, { type: 'agentEvent', phase: 'start' }],
      };
    }

    case 'TurnEnded': {
      const active = activeTurnFromPhase(s.phase);
      if (!active) return warn(s, `TurnEnded with no active turn (phase: '${s.phase.kind}')`);
      const stopReason = ev.outcome.kind === 'stopped' ? ev.outcome.stopReason : null;
      return {
        state: { ...s, phase: { kind: 'ready' }, lastStopReason: stopReason },
        effects: [
          { type: 'state' },
          { type: 'agentEvent', phase: ev.outcome.kind === 'errored' ? 'error' : 'stop' },
        ],
      };
    }

    case 'CancellationRequested': {
      if (s.phase.kind !== 'working') {
        return warn(s, `CancellationRequested in phase '${s.phase.kind}'`);
      }
      const drainEffects: Effect[] = s.pendingPermissions.map((p) => ({
        type: 'permissionResolved' as const,
        requestId: p.requestId,
        cancelled: true,
      }));
      return {
        state: { ...s, phase: { kind: 'cancelling', turn: s.phase.turn }, pendingPermissions: [] },
        effects: [...drainEffects, { type: 'state' }],
      };
    }

    case 'PermissionRequested':
      return {
        state: { ...s, pendingPermissions: [...s.pendingPermissions, ev.request] },
        effects: [{ type: 'permissionRequest', request: ev.request }],
      };

    case 'PermissionResolved':
      return {
        state: {
          ...s,
          pendingPermissions: s.pendingPermissions.filter((p) => p.requestId !== ev.requestId),
        },
        effects: [{ type: 'permissionResolved', requestId: ev.requestId, cancelled: false }],
      };

    case 'MetaChanged':
      return {
        state: {
          ...s,
          modes: ev.modes !== undefined ? (ev.modes ?? s.modes) : s.modes,
          configOptions:
            ev.configOptions !== undefined
              ? (ev.configOptions ?? s.configOptions)
              : s.configOptions,
        },
        effects: [{ type: 'meta' }],
      };

    case 'ProcessClosed': {
      const drainEffects: Effect[] = s.pendingPermissions.map((p) => ({
        type: 'permissionResolved' as const,
        requestId: p.requestId,
        cancelled: true,
      }));
      return {
        state: {
          ...s,
          phase: { kind: 'closed', exitCode: ev.exitCode },
          pendingPermissions: [],
        },
        effects: [...drainEffects, { type: 'state' }, { type: 'closed', exitCode: ev.exitCode }],
      };
    }
  }
}

function warn(
  s: SessionMachineState,
  message: string
): { state: SessionMachineState; effects: Effect[] } {
  return { state: s, effects: [{ type: 'warn', message }] };
}

function makeTurn(s: SessionMachineState): ControlTurn {
  return { id: `turn-${s.conversationId}-${s.nextTurnIndex}` };
}

function needsSetupMetaEffect(ev: {
  modes?: SessionModeState | null;
  configOptions?: readonly SessionConfigOption[] | null;
}): boolean {
  return ev.modes !== undefined || ev.configOptions !== undefined;
}

export function isPromptReady(lifecycle: SessionLifecycle): boolean {
  return lifecycle === 'ready';
}

export class SessionMachine {
  private _state: SessionMachineState;

  constructor(conversationId: string) {
    this._state = initialMachineState(conversationId);
  }

  get phase(): SessionPhase {
    return this._state.phase;
  }
  get lifecycle(): SessionLifecycle {
    return phaseToLifecycle(this._state.phase);
  }
  get pendingPermissions(): readonly AcpPermissionRequest[] {
    return this._state.pendingPermissions;
  }
  get modes(): SessionModeState | null {
    return this._state.modes;
  }
  get nextTurnIndex(): number {
    return this._state.nextTurnIndex;
  }
  get lastStopReason(): StopReason | null {
    return this._state.lastStopReason;
  }
  get isWorking(): boolean {
    return this._state.phase.kind === 'working' || this._state.phase.kind === 'cancelling';
  }
  get isBusy(): boolean {
    const k = this._state.phase.kind;
    return k === 'starting' || k === 'replaying' || k === 'working' || k === 'cancelling';
  }
  get hasPendingPermission(): boolean {
    return this._state.pendingPermissions.length > 0;
  }
  get canSubmit(): boolean {
    return isPromptReady(this.lifecycle) && !this.hasPendingPermission;
  }
  get canCancel(): boolean {
    return this._state.phase.kind === 'working';
  }

  dispatch(cmd: Command): Result<Effect[], AcpRuntimeError> {
    const decision = decide(this._state, cmd);
    if (!decision.success) return decision;
    const allEffects: Effect[] = [];
    for (const event of decision.data) {
      const { state, effects } = evolve(this._state, event);
      this._state = state;
      allEffects.push(...effects);
    }
    return ok(allEffects);
  }

  apply(...events: DomainEvent[]): Effect[] {
    const allEffects: Effect[] = [];
    for (const event of events) {
      const { state, effects } = evolve(this._state, event);
      this._state = state;
      allEffects.push(...effects);
    }
    return allEffects;
  }

  applySnapshot(s: SessionSnapshot): void {
    const activeTurnId = s.activeTurnId;
    let phase: SessionPhase;
    switch (s.lifecycle) {
      case 'starting':
        phase = { kind: 'starting' };
        break;
      case 'replaying':
        phase = { kind: 'replaying', turn: { id: activeTurnId ?? 'replay' } };
        break;
      case 'working':
        phase = { kind: 'working', turn: { id: activeTurnId ?? 'working' } };
        break;
      case 'cancelling':
        phase = { kind: 'cancelling', turn: { id: activeTurnId ?? 'cancelling' } };
        break;
      case 'ready':
        phase = { kind: 'ready' };
        break;
      case 'closed':
        phase = { kind: 'closed', exitCode: null };
        break;
    }
    this._state = {
      ...this._state,
      phase,
      pendingPermissions: s.pendingPermissions,
      modes: s.modes,
      configOptions: s.configOptions,
      lastStopReason: s.lastStopReason,
    };
  }

  sessionState(): SessionState {
    const activeTurn = activeTurnFromPhase(this._state.phase);
    return {
      lifecycle: this.lifecycle,
      activeTurnId: activeTurn?.id ?? null,
      pendingPermissions: structuredClone([...this._state.pendingPermissions]),
      modes: this._state.modes ? structuredClone(this._state.modes) : null,
      configOptions: structuredClone([...this._state.configOptions]),
      lastStopReason: this._state.lastStopReason,
    };
  }
}
