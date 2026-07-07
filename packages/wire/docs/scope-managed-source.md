# Scope and ManagedSource

`Scope` and `ManagedSource` are lifecycle utilities exported from
`@emdash/wire/util`.

- `Scope` owns cleanup for a tree of resources.
- `ManagedSource` turns demand into a retained resource with ref-counted leases.

They do not define wire messages and can run in browser, renderer, main process,
or tests.

## Scope

Use a scope when a feature creates more than one disposable resource and those
resources should die together:

```ts
import { createScope } from '@emdash/wire/util';

const scope = createScope({ label: 'conversation:abc' });

scope.add(() => detachLiveModel());
scope.add(() => removeWindowListener());
scope.use({ dispose: () => runtime.dispose() });

await scope.dispose();
```

Semantics:

- Cleanups run in reverse registration order.
- Child scopes dispose before the parent's own cleanups.
- Cleanup errors are reported through `onCleanupError` and do not stop later
  cleanups.
- Each scope has a structured `scope.log`; children inherit the logger with a
  `scope` binding for their label path.
- `dispose()` is idempotent.
- `add()` on an already disposed scope runs the cleanup immediately.

That last rule makes async attach/dispose races easier to handle:

```ts
const scope = createScope();
await scope.dispose();

scope.add(() => detachTopic()); // runs immediately
```

## Child Scopes

Use child scopes to model ownership:

```ts
const runtimeScope = createScope({ label: 'runtime' });
const sessionScope = runtimeScope.child('session:one');

sessionScope.log.info('session attached');
sessionScope.add(() => stopSession());
runtimeScope.add(() => stopRuntime());

await runtimeScope.dispose();
```

Disposing `runtimeScope` disposes `sessionScope` first, then `stopRuntime()`.
Use `describeScope(runtimeScope)` when debugging retained resources; it returns
the current label tree without exposing cleanup internals.

## ManagedSource

`ManagedSource` is useful when a resource should exist only while somebody is
using it: a live topic binding, a renderer view model, a preview server, or a
process-backed session.

```ts
import { createManagedSource } from '@emdash/wire/util';

const sessions = createManagedSource({
  key: (input: { conversationId: string }) => input.conversationId,
  graceMs: 30_000,
  create: async ({ conversationId }, scope) => {
    const session = await startSession(conversationId);
    scope.add(() => session.stop());
    return session;
  },
});

const lease = sessions.acquire({ conversationId: 'abc' });
const session = await lease.ready();

await lease.release();
```

Behavior:

- The first `acquire()` for a key calls `create()`.
- Concurrent acquires for the same key share the in-flight creation.
- Each lease increments the refcount.
- `release()` is idempotent.
- The last release starts the grace timer.
- Acquire during the grace timer cancels teardown and reuses the active value.
- Failed creation is not cached; the next acquire retries.
- `dispose()` force-disposes every active or retained entry.

## Grace Windows

Use `graceMs` for resources whose demand can flap briefly. For example, a window
reload may detach and reattach live model bindings within a few hundred
milliseconds. A short grace window avoids tearing down the underlying resource
only to recreate it immediately.

```ts
const bindings = createManagedSource({
  key: (key: { taskId: string }) => key.taskId,
  graceMs: 5_000,
  create: async (key, scope) => {
    const binding = client.task.transcript(key, (state) => render(state));
    scope.add(() => binding.dispose());
    await binding.ready;
    return binding;
  },
});
```

## Examples

See:

- [../examples/scope/client.ts](../examples/scope/client.ts)
- [../examples/managed-source/client.ts](../examples/managed-source/client.ts)
