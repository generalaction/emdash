# TypeScript And React Conventions

## TypeScript

- strict mode is enabled in both app tsconfigs
- prefer explicit types over `any`
- use `import type` where possible

## Renderer

- functional React components and hooks
- context providers under `src/renderer/contexts/`
- hooks under `src/renderer/hooks/`
- client-side stores and helpers under `src/renderer/lib/`

## Naming

- components: PascalCase
- hooks: `useX` camelCase or existing patterns like `use-toast.ts`
- tests: `*.test.ts`
