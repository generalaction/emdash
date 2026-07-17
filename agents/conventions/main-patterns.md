# Main Process Patterns

## Controller Pattern

Each domain exposes a Wire contract in `src/core/features/<domain>/api/` and a controller in
`src/core/features/<domain>/node/`:

```ts
// src/core/features/tasks/node/wire-controller.ts
export function createTasksWireController(): Controller {
  return createController(tasksWireContract, {
    createTask: (input) => taskOperations.createTask(input),
    events: taskEvents,
  });
}
```

Contracts are assembled in `src/core/manifests/desktop-wire-contract.ts`; controllers are served by
`src/main/gateway/desktop-wire.ts`.

**Rules:**
- Controller handlers delegate to imported operations or services.
- Keep portable contracts in `api/` and Node implementation in `node/`.
- Register new domains in the desktop Wire manifest and gateway.


## Service Pattern

For stateful concerns, use singleton classes:

```ts
export class AppService {
  private cache = new Map();

  async initialize() { /* ... */ }
  async doSomething(id: string) { /* ... */ }
}

export const appService = new AppService();
```

**Rules:**
- Module-level singleton export
- Initialization method called from `src/main/index.ts`
- Services hold long-lived state (caches, subscriptions, connections)

## Provider Pattern

For domain logic with multiple backends (local vs SSH):

```
src/main/core/projects/
├── project-provider.ts          # Interface
├── impl/
│   ├── local-project-provider.ts
│   └── _ssh-project-provider.ts  # Prefixed with _ = not yet implemented
└── project-manager.ts           # Orchestrates providers
```

Used in: projects, filesystem (`local-fs.ts` / `ssh-fs.ts`), terminals (`local-terminal-provider.ts` / `ssh-terminal-provider.ts`)

## Result Type (`src/main/lib/result.ts`)

Explicit error handling via discriminated union:

```ts
import { ok, err, type Result } from '../lib/result';

async function doSomething(): Promise<Result<Data, SomeError>> {
  if (problem) return err({ type: 'not_found' as const });
  return ok(data);
}
```

**Rules:**
- Prefer `Result<T, E>` over thrown exceptions for expected failure modes
- Controllers expose Result types through Wire contracts

## Event Streams

Use Wire event-stream hosts for main-to-renderer notifications:

```ts
export const taskEvents = createEventStreamHost(tasksWireContract.events);
taskEvents.emit(undefined, { type: 'created', task });
```

Event definitions belong to the owning slice's portable API. Use live models for replicated state
and live jobs for cancellable long-running work.
