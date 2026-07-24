# Wire Errors

Wire has two error planes:

- Expected domain failures travel as `Result` payloads. Prefer `fallible()` for
  procedure contracts whose callers should handle failures as ordinary data.
- Thrown `WireError`s are reserved for infrastructure failures, contract drift,
  lifecycle mistakes, and uncaught handler exceptions.

`WireError` instances carry a typed `code`, a message, and an optional serialized
cause. When an uncaught JavaScript error crosses the wire, the transport serializes
it as `HANDLER_ERROR` with a clone-safe cause.

## Codes

### `CANCELLED`

The call was aborted. The client raises it when the caller's `AbortSignal` is
already aborted or aborts while a call is pending. The server raises it when it
receives a `cancel` message and the handler observes the abort.

Retrying is not automatic and usually not appropriate because cancellation was
caller intent.

### `DISCONNECTED`

The transport disconnected while a request was pending, or posting a request
failed because the peer was already gone.

This is the only code the contract mutation retry loop retries by default. That
retry is safe because mutations carry a stable `mutationId` and the server
deduplicates repeated ids.

### `UNKNOWN_PROCEDURE`

No procedure handler exists for the call path. Common causes are an incorrect
client path, a missing implementation branch in `createController()`, or a drift
between the contract and the controller implementation.

This is not retryable without changing code or wiring.

### `UNKNOWN_TOPIC`

The live topic's ref id is not registered by the controller.

This usually means the client encoded the wrong live ref id, or a controller was
created without the endpoint that owns the ref. It is not retryable without
changing the topic or server wiring.

### `NOT_FOUND`

The live ref id is known, but no live instance exists for the provided key.
Examples include a live model group instance that has not been created yet or a
job state that has already been evicted.

Retrying may make sense only if the domain resource is expected to appear later.

### `MISSING_HANDLER`

Controller creation-time error: a contract endpoint has no implementation. Examples include a
missing procedure implementation, missing live resolver, missing job handler, or
missing live model host.

This should not cross the wire during normal operation. Fix the controller implementation.

### `CONTRACT_MISMATCH`

Controller creation-time error: a `LiveModelHost` was created for a different live model
contract than the contract endpoint being bound.

This is not retryable; fix the host/contract pairing.

### `ALREADY_EXISTS`

`LiveModelHost.create()` was called for a key that already has a live instance.

This is a lifecycle error. Dispose or reuse the existing instance instead of
creating another one for the same key.

### `TIMEOUT`

A Wire procedure exceeded an infrastructure deadline, usually from
`withTimeout()` middleware. Timeout is distinct from `CANCELLED`: cancellation is
caller intent, while timeout means the server-side policy stopped waiting for the
operation.

Timeouts are not retried automatically. Contract mutations still retry only
`DISCONNECTED` by default because mutation retry depends on stable `mutationId`
deduplication. If a domain treats a timeout as an expected outcome, model it as a
`Result` payload instead of relying on the infrastructure error plane.

### `HANDLER_ERROR`

An uncaught exception escaped a server handler or validation boundary. Expected
domain failures should be modeled as `Result` payloads with `fallible()` instead
of thrown.

The serialized wire error includes the thrown value as a clone-safe cause. Treat
this as a bug signal and fix the handler or validation logic.

## Live Attachment Errors

Live attachments use the same infrastructure error plane as calls and snapshots.
They do not wrap startup or lifecycle failures in endpoint `Result` payloads.

Initial attachment failures reject the `attach()` or event-stream `subscribe()`
promise with a `WireError`. Common codes are `DISCONNECTED`, `UNKNOWN_TOPIC`,
`NOT_FOUND`, and `HANDLER_ERROR`.

Once an attachment is established, the client keeps it as durable intent across
transport reconnects. Reattach failures are delivered to the subscription's
`onReattachError` or `onError` callback with `{ retrying }`:

- `DISCONNECTED` is reported with `retrying: true`; the attachment stays
  registered and will try again on the next reconnect.
- Other `WireError`s are reported with `retrying: false`; the attachment is
  terminated because retrying the same topic would repeat the same failure.

Forwarding preserves these lifecycle notifications. A downstream connection can
remain healthy while an upstream live attachment reports a gap or terminal error.
Forwarding sends those as live lifecycle messages rather than hiding them behind
the downstream transport state.

These errors are distinct from expected domain events carried by a stream. For
example, fs-watch may emit `{ kind: 'error' }` as part of its event payload when a
native watcher fails to start. That payload belongs to the fs-watch contract. A
live attachment `WireError` means the wire topic itself could not attach or
reattach.
