# IPC Conventions

## RPC Pattern

The primary IPC mechanism is a typed RPC system:

- **Controllers**: `src/main/core/*/controller.ts` — define handler functions using `createRPCController`.
- **Router**: `src/main/rpc.ts` — assembles all controllers into a typed router using `createRPCRouter`.
- **Registration**: `registerRPCRouter(router, ipcMain)` in `src/main/index.ts` — auto-registers `namespace.method` channels.
- **Client**: `src/renderer/lib/ipc.ts` — creates a proxy-based typed client using `createRPCClient<RpcRouter>`.

```ts
// Main — src/main/core/example/controller.ts
import { createRPCController } from '@shared/ipc/rpc';
export const exampleController = createRPCController({
  async doSomething(id: string) {
    return await service.doSomething(id);
  },
});

// Renderer — call via typed client
import { rpc } from '@renderer/lib/ipc';
const result = await rpc.example.doSomething('123');
```

## Preload Bridge

The preload bridge in `src/preload/index.ts` is intentionally tiny. It exposes only
`invoke` (for the RPC client), `eventSend`/`eventOn` (for the typed event emitter), and
`getPathForFile` on `window.electronAPI`. Add direct `window.electronAPI` surface only
when a browser/Electron primitive cannot fit the RPC/event path.

## Event System

Typed events use `createEventEmitter` from `src/shared/ipc/events.ts`. Event type definitions live in `src/shared/events/`.

## Rules

- Prefer the RPC pattern for new IPC methods — add a handler to the appropriate controller.
- Keep the preload bridge small; do not add manual IPC channels casually.
- Keep the RPC router type (`RpcRouter`) importable by the renderer for type inference.
- Prefer existing service boundaries over adding logic directly inside controllers.
- Update tests when controller shape or IPC wiring changes.
