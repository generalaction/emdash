/**
 * Pure ACP session state machine.
 *
 * Separates inputs into two distinct kinds:
 *
 * - Commands — intents from the public API that MAY be rejected by validation.
 *   They produce zero or more DomainEvents on success, or an AcpRuntimeError on
 *   failure. No state changes occur on rejection.
 *
 * - DomainEvents — facts from the agent process, ACP notifications, or our own
 *   orchestration that are ALWAYS folded into state. An out-of-place event
 *   yields only a diagnostic `warn` Effect, never an error.
 *
 * The two pure functions `decide` and `evolve` contain no I/O. The runtime
 * feeds commands through `decide` to get events, then feeds events through
 * `evolve` to get the next state and the list of Effects to perform.
 *
 * State machine transitions:
 *
 *   starting → replaying (E: ReplayStarted — only when loadSession capable)
 *   starting → ready     (E: SessionReady — newSession path)
 *   replaying → ready    (E: ReplayEnded)
 *   ready → working      (C: Prompt → E: PromptStarted)
 *   working → ready      (E: TurnEnded)
 *   working → cancelling (C: Cancel → E: CancellationRequested)
 *   cancelling → ready   (E: TurnEnded)
 *   {ready,working,cancelling} → closed (E: PoolClosed)
 */

import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  StopReason,
} from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { AgentUpdate } from './agent-update';
import type { AcpRuntimeError } from './errors';
import { acpErr } from './errors';
import type { AcpPermissionRequest } from './permissions';
import type { AcpTurn, TurnSource, TurnStatus } from './turns';

// ---------------------------------------------------------------------------
// Phase (discriminated union carrying the active turn in-line)
// ---------------------------------------------------------------------------

export type SessionPhase =
  | { kind: 'starting' }
  | { kind: 'replaying'; turn: AcpTurn }
  | { kind: 'ready' }
  | { kind: 'working'; turn: AcpTurn }
  | { kind: 'cancelling'; turn: AcpTurn }
  | { kind: 'closed'; exitCode: number | null };

/** Derives the `SessionLifecycle` string from a phase. */
export function phaseToLifecycle(phase: SessionPhase): SessionLifecycle {
  return phase.kind;
}

/** The active turn if the phase carries one, otherwise null. */
export function activeTurnFromPhase(phase: SessionPhase): AcpTurn | null {
  if (phase.kind === 'replaying' || phase.kind === 'working' || phase.kind === 'cancelling') {
    return phase.turn;
  }
  return null;
}

// Re-export for consumers that only care about the lifecycle string
export type SessionLifecycle =
  | 'starting'
  | 'replaying'
  | 'ready'
  | 'working'
  | 'cancelling'
  | 'closed';

// ---------------------------------------------------------------------------
// Machine state
// ---------------------------------------------------------------------------

export interface SessionMachineState {
  readonly conversationId: string;
  readonly phase: SessionPhase;
  readonly committedTurns: readonly AcpTurn[];
  readonly pendingPermissions: readonly AcpPermissionRequest[];
  /**
   * Agent-advertised session modes. Null until the first newSession or
   * loadSession response arrives, or if the agent doesn't support modes.
   */
  readonly modes: SessionModeState | null;
  /**
   * Full set of session config options as reported by the agent. The model
   * selector is one of these (category === 'model'). Authoritative — updated
   * from newSession/loadSession responses, setSessionConfigOption responses,
   * and config_option_update notifications.
   */
  readonly configOptions: readonly SessionConfigOption[];
  /** Slash commands the agent currently supports. */
  readonly availableCommands: readonly AvailableCommand[];
  /**
   * The stop reason from the last completed turn. Null on first start or
   * if no turn has completed yet. Drives the composer's notice band.
   */
  readonly lastStopReason: StopReason | null;
  /** Monotonic sequence counter — shared across all turns of a conversation. */
  readonly nextSeq: number;
  /** Counter used to generate unique, stable turn ids. */
  readonly nextTurnIndex: number;
}

export function initialMachineState(conversationId: string): SessionMachineState {
  return {
    conversationId,
    phase: { kind: 'starting' },
    committedTurns: [],
    pendingPermissions: [],
    modes: null,
    configOptions: [],
    availableCommands: [],
    lastStopReason: null,
    nextSeq: 0,
    nextTurnIndex: 0,
  };
}

// ---------------------------------------------------------------------------
// Commands (validated intents — may be rejected)
// ---------------------------------------------------------------------------

export type Command =
  /** Send a user message to the agent. Only valid when phase === 'ready'. */
  | { type: 'Prompt'; userUpdate: AgentUpdate }
  /** Cancel the in-flight turn. Only valid when phase === 'working'. Idempotent elsewhere. */
  | { type: 'Cancel' }
  /**
   * Resolve a pending permission request. Only valid when the requestId is
   * present in pendingPermissions.
   */
  | { type: 'ResolvePermission'; requestId: string; optionId: string | null }
  /** Switch the active session mode. Only valid when modes is non-null and modeId is available. */
  | { type: 'SetMode'; modeId: string }
  /**
   * Change the active model (or any other config option by id). The runtime
   * sends this as setSessionConfigOption; the response is authoritative.
   */
  | { type: 'SetConfigOption'; configId: string; value: string };

// ---------------------------------------------------------------------------
// Domain events (facts — always folded)
// ---------------------------------------------------------------------------

export type DomainEvent =
  /** Session established via loadSession — replay turn begins. */
  | { type: 'ReplayStarted' }
  /** Replay turn finished. */
  | { type: 'ReplayEnded'; status: Exclude<TurnStatus, 'active'> }
  /** Session established via newSession — immediately ready. */
  | {
      type: 'SessionReady';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  /** Session loaded via loadSession — session is ready after replay. Carries session metadata. */
  | {
      type: 'SessionLoaded';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  /** A new live turn begins, opening the working phase. */
  | { type: 'PromptStarted'; userUpdate: AgentUpdate }
  /** A turn-level update arrived from the agent. */
  | { type: 'Updated'; update: AgentUpdate }
  /** The active turn ended. */
  | { type: 'TurnEnded'; outcome: TurnOutcome }
  /** User initiated cancellation — transition to cancelling. */
  | { type: 'CancellationRequested' }
  /** Agent requested user permission for a tool call. */
  | { type: 'PermissionRequested'; request: AcpPermissionRequest }
  /** A pending permission was resolved (by user or by drain). */
  | { type: 'PermissionResolved'; requestId: string }
  /** Session-scoped metadata changed (modes / configOptions / availableCommands). */
  | {
      type: 'MetaChanged';
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
      availableCommands?: readonly AvailableCommand[] | null;
    }
  /** The agent process exited or the connection closed. */
  | { type: 'PoolClosed'; exitCode: number | null };

export type TurnOutcome = { kind: 'stopped'; stopReason: StopReason } | { kind: 'errored' };

// ---------------------------------------------------------------------------
// Effects (outputs that the runtime interprets — no I/O inside the machine)
// ---------------------------------------------------------------------------

export type Effect =
  /** Emit the current lifecycle + activeTurnId to the listener. */
  | { type: 'state' }
  /** Emit a turn update to the listener. */
  | { type: 'update'; turnId: string; seq: number; update: AgentUpdate }
  /** Commit the turn to history and notify the listener. */
  | { type: 'turnCommitted'; turn: AcpTurn }
  /** Notify the listener of a new permission request. */
  | { type: 'permissionRequest'; request: AcpPermissionRequest }
  /**
   * Notify the listener that a permission was resolved. Also answers the
   * non-serializable resolver callback held by the runtime.
   */
  | { type: 'permissionResolved'; requestId: string; cancelled: boolean }
  /** Notify the listener that session-scoped metadata changed. */
  | { type: 'meta' }
  /** Notify the listener that the session closed. */
  | { type: 'closed'; exitCode: number | null }
  /** Emit start/stop/error agent lifecycle events. */
  | { type: 'agentEvent'; phase: 'start' | 'stop' | 'error' }
  /** Log a diagnostic warning for unexpected but non-fatal situations. */
  | { type: 'warn'; message: string };

// ---------------------------------------------------------------------------
// decide — pure validation, no state change
// ---------------------------------------------------------------------------

/**
 * Validates a command against the current state. Returns the list of
 * DomainEvents to fold if valid, or an AcpRuntimeError if not.
 */
export function decide(
  s: SessionMachineState,
  cmd: Command
): Result<DomainEvent[], AcpRuntimeError> {
  switch (cmd.type) {
    case 'Prompt': {
      if (s.phase.kind !== 'ready') {
        return acpErr.invalidState(`Cannot send a prompt while session is '${s.phase.kind}'`);
      }
      return ok([{ type: 'PromptStarted', userUpdate: cmd.userUpdate }]);
    }

    case 'Cancel': {
      if (s.phase.kind !== 'working') {
        // Idempotent — cancelling or already ready/closed is fine
        return ok([]);
      }
      return ok([{ type: 'CancellationRequested' }]);
    }

    case 'ResolvePermission': {
      const found = s.pendingPermissions.some((p) => p.requestId === cmd.requestId);
      if (!found) {
        return acpErr.invalidState(`No pending permission request with id '${cmd.requestId}'`);
      }
      return ok([{ type: 'PermissionResolved', requestId: cmd.requestId }]);
    }

    case 'SetMode': {
      if (!s.modes) {
        return acpErr.invalidState('Agent does not support session modes');
      }
      const available = s.modes.availableModes.some((m) => m.id === cmd.modeId);
      if (!available) {
        return acpErr.setModeFailed({
          name: 'Error',
          message: `Mode '${cmd.modeId}' is not in the available modes list`,
        });
      }
      // The actual RPC call happens in the runtime; the machine only validates.
      // The MetaChanged event arrives after the RPC response and is the truth.
      return ok([]);
    }

    case 'SetConfigOption': {
      // Validation: option must exist. The runtime sends the RPC and then
      // applies the returned configOptions via a MetaChanged event.
      const exists = s.configOptions.some((o) => o.id === cmd.configId);
      if (!exists) {
        return acpErr.setConfigFailed({
          name: 'Error',
          message: `Config option '${cmd.configId}' is not known`,
        });
      }
      return ok([]);
    }
  }
}

// ---------------------------------------------------------------------------
// evolve — pure fold, no side effects
// ---------------------------------------------------------------------------

/**
 * Folds a DomainEvent into a new state, returning the updated state and the
 * list of Effects that the runtime must perform (I/O, listener calls, etc.).
 * An out-of-place event yields only a `warn` Effect and leaves state unchanged.
 */
export function evolve(
  s: SessionMachineState,
  ev: DomainEvent
): { state: SessionMachineState; effects: Effect[] } {
  switch (ev.type) {
    case 'ReplayStarted': {
      if (s.phase.kind !== 'starting') {
        return warn(s, `ReplayStarted in phase '${s.phase.kind}'`);
      }
      const turn = makeTurn(s, 'replay');
      return {
        state: {
          ...s,
          phase: { kind: 'replaying', turn },
          nextTurnIndex: s.nextTurnIndex + 1,
        },
        effects: [{ type: 'state' }],
      };
    }

    case 'ReplayEnded': {
      if (s.phase.kind !== 'replaying') {
        return warn(s, `ReplayEnded in phase '${s.phase.kind}'`);
      }
      const turn = s.phase.turn;
      const committed: AcpTurn = {
        ...turn,
        status: ev.status,
        endSeq: s.nextSeq,
        stopReason: null,
      };
      return {
        state: {
          ...s,
          phase: { kind: 'ready' },
          committedTurns: [...s.committedTurns, committed],
        },
        effects: [{ type: 'turnCommitted', turn: committed }, { type: 'state' }],
      };
    }

    case 'SessionReady': {
      if (s.phase.kind !== 'starting') {
        return warn(s, `SessionReady in phase '${s.phase.kind}'`);
      }
      return {
        state: {
          ...s,
          phase: { kind: 'ready' },
          modes: ev.modes ?? s.modes,
          configOptions: ev.configOptions ?? s.configOptions,
        },
        effects: [
          { type: 'state' },
          ...(needsMetaEffect(s, ev) ? ([{ type: 'meta' }] as Effect[]) : []),
        ],
      };
    }

    case 'SessionLoaded': {
      if (s.phase.kind !== 'replaying') {
        return warn(s, `SessionLoaded in phase '${s.phase.kind}'`);
      }
      return {
        state: {
          ...s,
          modes: ev.modes ?? s.modes,
          configOptions: ev.configOptions ?? s.configOptions,
        },
        effects: needsMetaEffect(s, ev) ? [{ type: 'meta' }] : [],
      };
    }

    case 'PromptStarted': {
      if (s.phase.kind !== 'ready') {
        return warn(s, `PromptStarted in phase '${s.phase.kind}'`);
      }
      const turn = makeTurn(s, 'live');
      const seq = s.nextSeq;
      // Record the synthesized user message as the leading update
      const turnWithUser: AcpTurn = {
        ...turn,
        updates: [{ seq, update: ev.userUpdate }],
      };
      return {
        state: {
          ...s,
          phase: { kind: 'working', turn: turnWithUser },
          nextSeq: seq + 1,
          nextTurnIndex: s.nextTurnIndex + 1,
        },
        effects: [
          { type: 'state' },
          { type: 'update', turnId: turn.id, seq, update: ev.userUpdate },
          { type: 'agentEvent', phase: 'start' },
        ],
      };
    }

    case 'Updated': {
      const active = activeTurnFromPhase(s.phase);
      if (!active) {
        return warn(s, `Updated with no active turn (phase: '${s.phase.kind}')`);
      }
      const seq = s.nextSeq;
      const updatedTurn: AcpTurn = {
        ...active,
        updates: [...active.updates, { seq, update: ev.update }],
      };
      return {
        state: {
          ...s,
          phase: replaceTurnInPhase(s.phase, updatedTurn),
          nextSeq: seq + 1,
        },
        effects: [{ type: 'update', turnId: active.id, seq, update: ev.update }],
        // NB: lifecycle deliberately unchanged — Updated never flips to 'working'
      };
    }

    case 'TurnEnded': {
      const active = activeTurnFromPhase(s.phase);
      if (!active) {
        return warn(s, `TurnEnded with no active turn (phase: '${s.phase.kind}')`);
      }
      const stopReason = ev.outcome.kind === 'stopped' ? ev.outcome.stopReason : null;
      const status: Exclude<TurnStatus, 'active'> =
        ev.outcome.kind === 'errored'
          ? 'error'
          : stopReason === 'cancelled'
            ? 'cancelled'
            : 'complete';
      const committed: AcpTurn = {
        ...active,
        status,
        endSeq: s.nextSeq,
        stopReason,
      };
      return {
        state: {
          ...s,
          phase: { kind: 'ready' },
          committedTurns: [...s.committedTurns, committed],
          lastStopReason: stopReason,
        },
        effects: [
          { type: 'turnCommitted', turn: committed },
          { type: 'state' },
          { type: 'agentEvent', phase: ev.outcome.kind === 'errored' ? 'error' : 'stop' },
        ],
      };
    }

    case 'CancellationRequested': {
      if (s.phase.kind !== 'working') {
        return warn(s, `CancellationRequested in phase '${s.phase.kind}'`);
      }
      // Drain all pending permissions with cancelled=true
      const drainEffects: Effect[] = s.pendingPermissions.map((p) => ({
        type: 'permissionResolved' as const,
        requestId: p.requestId,
        cancelled: true,
      }));
      return {
        state: {
          ...s,
          phase: { kind: 'cancelling', turn: s.phase.turn },
          pendingPermissions: [],
        },
        effects: [...drainEffects, { type: 'state' }],
      };
    }

    case 'PermissionRequested': {
      return {
        state: {
          ...s,
          pendingPermissions: [...s.pendingPermissions, ev.request],
        },
        effects: [{ type: 'permissionRequest', request: ev.request }],
      };
    }

    case 'PermissionResolved': {
      return {
        state: {
          ...s,
          pendingPermissions: s.pendingPermissions.filter((p) => p.requestId !== ev.requestId),
        },
        effects: [{ type: 'permissionResolved', requestId: ev.requestId, cancelled: false }],
      };
    }

    case 'MetaChanged': {
      return {
        state: {
          ...s,
          modes: ev.modes !== undefined ? (ev.modes ?? s.modes) : s.modes,
          configOptions:
            ev.configOptions !== undefined
              ? (ev.configOptions ?? s.configOptions)
              : s.configOptions,
          availableCommands:
            ev.availableCommands !== undefined
              ? (ev.availableCommands ?? s.availableCommands)
              : s.availableCommands,
        },
        effects: [{ type: 'meta' }],
      };
    }

    case 'PoolClosed': {
      const drainEffects: Effect[] = s.pendingPermissions.map((p) => ({
        type: 'permissionResolved' as const,
        requestId: p.requestId,
        cancelled: true,
      }));
      const effects: Effect[] = [...drainEffects];
      const active = activeTurnFromPhase(s.phase);
      let newCommittedTurns = s.committedTurns;
      if (active) {
        const errorTurn: AcpTurn = {
          ...active,
          status: 'error',
          endSeq: s.nextSeq,
          stopReason: null,
        };
        newCommittedTurns = [...s.committedTurns, errorTurn];
        effects.push({ type: 'turnCommitted', turn: errorTurn });
      }
      effects.push({ type: 'state' }, { type: 'closed', exitCode: ev.exitCode });
      return {
        state: {
          ...s,
          phase: { kind: 'closed', exitCode: ev.exitCode },
          committedTurns: newCommittedTurns,
          pendingPermissions: [],
        },
        effects,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function warn(
  s: SessionMachineState,
  message: string
): { state: SessionMachineState; effects: Effect[] } {
  return { state: s, effects: [{ type: 'warn', message }] };
}

function makeTurn(s: SessionMachineState, source: TurnSource): AcpTurn {
  return {
    id: `turn-${s.conversationId}-${s.nextTurnIndex}`,
    status: 'active',
    source,
    startSeq: s.nextSeq,
    endSeq: null,
    stopReason: null,
    updates: [],
  };
}

function replaceTurnInPhase(phase: SessionPhase, turn: AcpTurn): SessionPhase {
  switch (phase.kind) {
    case 'replaying':
      return { kind: 'replaying', turn };
    case 'working':
      return { kind: 'working', turn };
    case 'cancelling':
      return { kind: 'cancelling', turn };
    default:
      return phase;
  }
}

/**
 * Returns true if the incoming session setup event carries metadata that differs
 * from what the machine already has. Used to decide whether to emit a `meta`
 * effect alongside the `state` effect.
 */
function needsMetaEffect(
  s: SessionMachineState,
  ev: { modes?: SessionModeState | null; configOptions?: readonly SessionConfigOption[] | null }
): boolean {
  return ev.modes !== undefined || ev.configOptions !== undefined;
}
