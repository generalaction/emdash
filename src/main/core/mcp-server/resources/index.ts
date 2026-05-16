/**
 * Aggregates registration of every MCP resource onto the SDK `Server`.
 *
 * Eventual responsibilities: call `register(server)` from each per-domain
 * resource module (projects, tasks, task sessions).
 *
 * Currently a stub — no-op.
 */
export function registerAllResources(_server: unknown): void {}
