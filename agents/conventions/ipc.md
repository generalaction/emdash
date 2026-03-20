# IPC Conventions

## RPC Pattern

The primary IPC mechanism is a typed RPC system:

- **Controllers**: `src/main/core/*/controller.ts` — define handler functions using `createRPCController`.
- **Router**: `src/main/rpc.ts` — assembles all controllers into a typed router using `createRPCRouter`.
- **Registration**: `registerRPCRouter(router, ipcMain)` in `src/main/index.ts` — auto-registers `namespace.method` channels.
- **Client**: `src/renderer/core/ipc.ts` — creates a proxy-based typed client using `createRPCClient<RpcRouter>`.

```ts
// Main — src/main/core/example/controller.ts
import { createRPCController } from '@shared/ipc/rpc';
export const exampleController = createRPCController({
  async doSomething(id: string) {
    return await service.doSomething(id);
  },
});

// Renderer — call via typed client
import { rpc } from '@renderer/core/ipc';
const result = await rpc.example.doSomething('123');
```

## Manual IPC (electron-api.d.ts)

A small set of IPC methods that depend on `event.sender` remain as manual handlers declared in `src/renderer/types/electron-api.d.ts` (~92 lines):

- PTY operations: `ptyStart`, `ptyStartDirect`, `ptyInput`, `ptyResize`, `ptyKill`
- Filesystem listing: `fsList`
- Open in external app: `openIn`
- Update events: `onUpdateEvent`

## Event System

Typed events use `createEventEmitter` from `src/shared/ipc/events.ts`. Event type definitions live in `src/shared/events/`.

## Rules

- Prefer the RPC pattern for new IPC methods — add a handler to the appropriate controller.
- Only use manual IPC when `event.sender` is required.
- Keep the RPC router type (`RpcRouter`) importable by the renderer for type inference.
- Prefer existing service boundaries over adding logic directly inside controllers.
- Update tests when controller shape or IPC wiring changes.
