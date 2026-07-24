# IPC Conventions

## Wire Pattern

All renderer-main application traffic uses `@emdash/wire`:

- **Contracts**: `src/core/features/<domain>/api/` using `defineContract`.
- **Controllers**: `src/core/features/<domain>/node/` using `createController`.
- **Manifest**: `src/core/manifests/shared/desktop-wire-contract.ts`.
- **Gateway**: `src/main/gateway/desktop-wire.ts`.
- **Client**: `src/renderer/lib/runtime/desktop-wire-client.ts`.

```ts
// Contract
export const exampleContract = defineContract({
  doSomething: procedure({
    input: z.object({ id: z.string() }),
    output: z.custom<Result>(),
  }),
});

// Renderer
const client = await getDesktopWireClient();
const result = await client.example.doSomething({ id: '123' });
```

## Preload Bridge

The preload bridge in `src/entry/preload.ts` exposes only `requestWirePort` and
`getPathForFile` on `window.electronAPI`. Add renderer-main operations to a Wire contract instead
of extending the bridge.

## Events And State

- Request/response operations use `procedure`.
- Notifications use `eventStream`.
- Broadcast state uses a Wire live model.
- Long-running cancellable work uses a Wire live job.
- Persisted renderer state uses mementos.

## Rules

- Keep contracts in the owning slice's `api/` surface and implementations in `node/`.
- Register contracts and controllers through the desktop Wire manifest and gateway.
- Keep provider-specific adaptation at plugin or slice edges.
- Never import a `node/` surface from browser code.
- Test contracts, controllers, event hosts, and browser stores at their owning boundary.
