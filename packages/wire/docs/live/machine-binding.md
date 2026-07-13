# Machine Bindings

`@emdash/shared/concurrency` owns the protocol-free machine primitives:
`createMachine()` for command/event/effect state transitions and
`createMachineEffectDriver()` for reentrancy-safe effect interpretation.

Wire only owns the live projection boundary. Use `bindMachineToLiveState()` when a
machine's current state needs to be exposed through a `LiveState`:

```ts
const binding = bindMachineToLiveState({
  machine,
  liveState: session.states.state,
  project: projectSessionState,
});
```

The binding:

- seeds the live state from the current machine projection;
- republishes after machine transition batches;
- suppresses structurally equal projections before calling `LiveState.replace()`;
- keeps Wire cursors, patches, snapshots, and replicas authoritative; and
- disposes only its subscription, not the caller-owned machine or live state.

Keep long-running work in `LiveJob`, and keep resource/process ownership in
`Scope`, `WorkerSlot`, or domain runtimes. Machines should represent local domain
state transitions; their effects should remain explicit data interpreted by the
host or runtime that owns the side effect.
