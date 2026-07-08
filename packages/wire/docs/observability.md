# Observability

`@emdash/wire` exposes observability at the same boundaries that own runtime
behavior: server calls, client calls, live topic attachment, mutation dedupe,
live-client resyncs, transport messages, and scope cleanup.

## Ambient Logger

The logger interface and redaction utilities live in `@emdash/shared/logger`.
Wire uses the shared ambient logger to attach call context without passing a
logger through every domain function:

```ts
import { log, runWithLogger } from '@emdash/shared/logger';

await runWithLogger(logger.child({ requestId: 'r1' }), async () => {
  log.info('handling request');
});
```

Node entry points can install the `AsyncLocalStorage` store:

```ts
import { installAsyncLogContext } from '@emdash/shared/logger/context-node';

installAsyncLogContext();
```

Browser and renderer code use a synchronous fallback. It still supports a root
logger and scoped synchronous blocks, but it does not preserve context across
`await`.

## Instrumentation Hooks

Use `WireInstrumentation` for typed events that can be adapted to logs, metrics,
or tracing:

```ts
const instrumentation = loggerInstrumentation(logger);

serve(transport, controller, { logger, instrumentation });
const connection = connect(clientTransport, { instrumentation });
const client = contractClient(api, connection, { instrumentation });
```

Hooks currently cover:

- procedure start/end, cancellation, and duration.
- snapshot timing and errors.
- live topic attach/detach.
- live model/log resync reasons.
- mutation dedupe hits.
- dropped `BatchedLiveModel` batches.
- scope cleanup errors.
- transport connect/disconnect events.

Helpers:

- `noopInstrumentation`: empty hooks object.
- `mergeInstrumentation(...parts)`: fan out events to several hook sets.
- `loggerInstrumentation(logger, options?)`: map hooks to structured log lines.
- `summarizePayload(value, options?)`: prepare, redact, stringify, and truncate a
  payload summary for debug logs.

`loggerInstrumentation(logger, { payloads: true })` includes redacted, truncated
payload summaries at debug level.

## Server Logging Middleware

Use `withLogging()` to decorate a `Controller` with semantic request logs:

```ts
const loggedController = withLogging(controller, logger, {
  level: 'debug',
  payloads: true,
});

serve(transport, loggedController, { logger });
```

This logs the endpoint path, duration, outcome, and optional redacted input and
result payloads. It composes with `bindContract()` and `mergeControllers()`
because it preserves the `Controller` shape.

Serving and client options are documented in [API serving](./api/serving.md).

## Protocol Debug Logging

Use `loggingTransport()` when you need a full wire-message firehose:

```ts
serve(
  loggingTransport(serverTransport, logger.child({ side: 'server' }), {
    payloads: true,
  }),
  withLogging(controller, logger, { level: 'debug', payloads: true })
);
```

This logs every sent and received protocol message: `call`, `result`, `snapshot`,
`attach`, `detach`, `update`, and `cancel`. Payload logging should be used for
local debugging because even redacted summaries can be noisy.

Transport construction is documented in [API transports](./api/transports.md).

## Scope Logging

`createScope({ logger, label })` attaches a logger to the scope tree. Children
inherit the logger with a `scope` binding containing their label path:

```ts
const runtimeScope = createScope({ label: 'runtime', logger });
const sessionScope = runtimeScope.child('session:abc');

sessionScope.log.info('session started');
```

Cleanup errors are reported through the scope logger by default. Use
`describeScope(scope)` for a lightweight label tree when debugging retained
resources.

Scope lifecycle behavior is documented in [runtime lifecycle](./runtime/lifecycle.md).

## Example

Run the logging example:

```bash
pnpm --filter @emdash/wire run example:logging
```

It wires together `withLogging()`, `loggingTransport()`, `loggerInstrumentation()`,
redacted debug payloads, and a forced live-client resync.
