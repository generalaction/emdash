// Re-exports from @emdash/shared — the helpers now live there.
// helpers/icon.tsx is NOT exported here — impl plugins import it directly
// to avoid mixing JSX/React into the non-JSX main package barrel.
export * from '@emdash/shared/agents/plugins';
export * from '@emdash/shared/agents/plugins/runtime';
