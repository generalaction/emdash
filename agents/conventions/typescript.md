# TypeScript And React Conventions

## TypeScript

- strict mode is enabled in `tsconfig.json`
- always use explicit types, do not use `any`
- prefer module imports at the top of the file, never use require() 
- single `tsconfig.json` for all targets (main, preload, renderer, shared)

## Renderer

- functional React components and hooks
- context providers under `src/renderer/contexts/`
- hooks under `src/renderer/hooks/`
- client-side stores and helpers under `src/renderer/lib/`
- core infrastructure under `src/renderer/core/` (IPC client, modal management, view state)
- view-level components under `src/renderer/views/`

## Naming

- components: PascalCase
- hooks: `useX` camelCase or existing patterns like `use-toast.ts`
- tests: `*.test.ts`
