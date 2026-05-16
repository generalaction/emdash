/**
 * Constructs the `@modelcontextprotocol/sdk` `Server` instance and wires the
 * curated tool and resource registries into it.
 *
 * Eventual responsibilities:
 * - Instantiate the SDK `Server` with emdash metadata (name, version,
 *   capabilities for tools + resources + subscriptions).
 * - Call `registerAllTools(server)` and `registerAllResources(server)` to
 *   mount the curated catalog.
 *
 * Currently a stub — returns `undefined` typed as `unknown` because the SDK
 * is not yet wired in.
 */
export function createMcpServer(): unknown {
  return undefined;
}
