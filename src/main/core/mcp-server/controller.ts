import { createRPCController } from '@shared/ipc/rpc';

/**
 * RPC controller for the renderer Settings page that drives the emdash MCP
 * server (start/stop, port changes, token rotation, recent calls).
 *
 * Eventual handlers (per design spec):
 * - `getStatus`, `setEnabled`, `setPort`, `rotateToken`, `getRecentCalls`.
 *
 * Currently a stub — empty handler map. Wiring into `src/main/rpc.ts` is
 * deferred until the controller has real handlers.
 */
export const mcpServerController = createRPCController({});
