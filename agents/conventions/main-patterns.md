# Main Process Patterns

## Controller Pattern

Each domain in `src/main/core/` exposes a `controller.ts` that defines RPC handlers:

```ts
// src/main/core/tasks/controller.ts
import { createRPCController } from '@shared/lib/ipc/rpc';
import { createTask } from './createTask';
import { getTasks } from './getTasks';

export const taskController = createRPCController({
  createTask,
  getTasks,
  deleteTask,
  // ...
});
```

Controllers are assembled into the router in `src/main/rpc.ts`:

```ts
export const rpcRouter = createRPCRouter({
  tasks: taskController,
  projects: projectController,
  // ...
});
```

**Rules:**
- Controller handlers are imported functions — keep logic in separate operation files, not inline
- Each controller becomes an RPC namespace (e.g., `rpc.tasks.createTask(...)` on the renderer)
- New domains need their controller added to `src/main/rpc.ts`


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

Used in: projects, terminals (`local-terminal-provider.ts` / `ssh-terminal-provider.ts`),
remote filesystem access (`src/main/core/runtime/legacy/ssh-file-system.ts` over SFTP via
`ssh-legacy-fs.ts`)

## Result Type (`packages/shared/src/result/index.ts`)

Explicit error handling via discriminated union, published as `@emdash/shared`:

```ts
import { ok, err, type Result } from '@emdash/shared';

async function doSomething(): Promise<Result<Data, SomeError>> {
  if (problem) return err({ type: 'not_found' as const });
  return ok(data);
}
```

`@emdash/shared/result` is also a valid, narrower import for just the Result utilities.

**Rules:**
- Prefer `Result<T, E>` over thrown exceptions for expected failure modes
- Controllers convert Result types to IPC-compatible responses

## Event System (`src/main/lib/events.ts`)

Topic-based event emitter for main ↔ renderer communication:

```ts
import { events } from '../lib/events';

// Emit to a specific topic (e.g., session ID)
events.emit(ptyDataChannel, buffer, sessionId);

// Listen on a specific topic
const unsub = events.on(ptyDataChannel, (data) => {...}, sessionId);
```

Channel naming: without topic → `eventName`, with topic → `eventName.{topic}`

Cross-cutting event type definitions live in `src/shared/events/`; domain-scoped events
live alongside their domain under `src/shared/core/<domain>/` (see
`agents/architecture/shared.md`).
