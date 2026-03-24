# IPC Conventions

## Core Contract

All renderer-facing IPC methods must be declared in:

- `src/renderer/types/electron-api.d.ts`

Use the standard response envelope:

```ts
return { success: true, data };
return { success: false, error: message };
```

## Main Locations

- `src/main/ipc/`
- selected colocated handlers in `src/main/services/`
- shared RPC utilities in `src/shared/ipc/rpc`

## Rules

- keep handler names and renderer typing in sync
- prefer existing service boundaries over adding logic directly inside handlers
- update tests when handler shape or IPC wiring changes
