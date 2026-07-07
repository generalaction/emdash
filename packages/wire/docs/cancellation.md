# Cancellation

Wire supports cooperative cancellation for procedure calls. Cancellation is a
transport-level concern: the client asks the server to stop work for a specific
call id, and the server exposes that request to the handler as an `AbortSignal`.

## Protocol

Each request/response call has an id. A client can send:

```ts
{ kind: 'cancel', id: callId }
```

The server aborts the matching in-flight call. If the handler rejects after the
signal is aborted, the reply uses the shared `CANCELLED` code.

## Client Usage

Typed procedure clients accept an optional `{ signal }` argument:

```ts
const abort = new AbortController();
const result = client.slowOperation({ id: 'task' }, { signal: abort.signal });

abort.abort();
await result; // rejects with WireError code CANCELLED
```

If the signal is already aborted, the call rejects locally without posting a
message.

## Server Usage

Procedure handlers receive the signal through `CallMeta`:

```ts
const controller = bindContract(api, {
  impl: {
    slowOperation: async (input, meta) => {
      await abortableWork(input, meta.signal);
      return { ok: true };
    },
  },
});
```

Cancellation is cooperative. Long-running handlers should pass the signal into
their own async work, listen for `abort`, or periodically check
`meta.signal?.aborted`.

## Disconnects and Relays

`serve()` aborts every in-flight call when the transport disconnects or the serve
loop is disposed. This prevents orphaned work when a renderer window closes.

`relayController()` forwards the same signal to the upstream connection, so
cancellation can propagate across hops such as renderer -> main -> subprocess.

## Mutations

Live model mutations are not cancellable through this API. A locally-cancelled
mutation whose server side continues running is easy to misuse because the live
model update may still commit. Mutations instead use `mutationId` for
idempotency and retry; see [Mutations](./mutations.md).

See [../examples/cancellation/client.ts](../examples/cancellation/client.ts).
