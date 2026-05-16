/**
 * Shared helpers for MCP tool handlers.
 *
 * All emdash tool handlers are thin adapters around existing operation
 * functions: they validate args (via Zod, in the registration site), delegate
 * to the op, and translate the result into an MCP `CallToolResult`. These
 * helpers centralise the response shape so every tool answers the same way.
 *
 * Conventions:
 * - Success → `{ content: [{ type: 'text', text: <json> }] }` (pretty-printed
 *   JSON, 2-space indent).
 * - Error   → `{ isError: true, content: [{ type: 'text', text: <json> }] }`
 *   where the JSON is `{ code, message, details? }`.
 * - Destructive ops (`task.delete`, `project.delete`, `mcp.remove`,
 *   `skill.uninstall`) require `confirm: true` and use `requireConfirm()` to
 *   short-circuit with a `CONFIRM_REQUIRED` error.
 *
 * Every wired handler should also be wrapped with `withRecording()` so the
 * tool name + duration + status lands in the recent-calls ring buffer that
 * the Settings UI surfaces.
 */
import { z } from 'zod';
import type { OpenInAppId } from '@shared/openInApps';
import type { Result } from '@shared/result';
import { recentCallsRing } from '../recent-calls';

// ─── Shared schemas / mappings ─────────────────────────────────────────────

/**
 * Editor enum exposed to MCP clients. Kept short on purpose — the catalog of
 * `OPEN_IN_APPS` (in `src/shared/openInApps.ts`) is much larger, but those
 * are renderer-facing and over-specific for the LLM surface. Anything not
 * present here can still be opened via the renderer.
 */
export const editorSchema = z.enum(['vscode', 'cursor', 'zed', 'sublime', 'terminal']);
export type EditorChoice = z.infer<typeof editorSchema>;

/**
 * Maps the MCP-facing `editor` value to a canonical `OpenInAppId`.
 *
 * `sublime` isn't in OPEN_IN_APPS today; it falls back to `zed` so the
 * external client gets *something* rather than a hard error. Adding a real
 * Sublime entry to `OPEN_IN_APPS` is a follow-up.
 */
export const editorToOpenInAppId: Record<EditorChoice, OpenInAppId> = {
  vscode: 'vscode',
  cursor: 'cursor',
  zed: 'zed',
  sublime: 'zed',
  terminal: 'terminal',
};

/**
 * Shape of the message body returned by every emdash MCP tool handler.
 *
 * Matches `CallToolResult` from `@modelcontextprotocol/sdk` closely enough
 * for the SDK to serialise it without further wrapping.
 */
export type McpToolReply =
  | { content: Array<{ type: 'text'; text: string }> }
  | { isError: true; content: Array<{ type: 'text'; text: string }> };

/** Format a successful tool result as a JSON-text reply. */
export function formatOk(data: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data ?? null, null, 2) }],
  };
}

/** Format a structured error reply. */
export function formatErr(
  code: string,
  message: string,
  details?: unknown
): { isError: true; content: [{ type: 'text'; text: string }] } {
  const payload = details === undefined ? { code, message } : { code, message, details };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Returns a `CONFIRM_REQUIRED` error reply unless `args.confirm === true`.
 *
 * Destructive tools call this at the top of their handler and bail out if it
 * returns a non-null reply:
 *
 * ```ts
 * const guard = requireConfirm(args, 'delete this task', { taskId });
 * if (guard) return guard;
 * ```
 */
export function requireConfirm(
  args: { confirm?: boolean },
  action: string,
  target: unknown
): null | ReturnType<typeof formatErr> {
  if (args.confirm === true) return null;
  return formatErr('CONFIRM_REQUIRED', `Set confirm: true to ${action}`, target);
}

/**
 * Translates a `Result<T, E>` from an existing operation function into an
 * MCP reply. `Ok` becomes a success payload; `Err` becomes a structured
 * error whose `details` field carries the original error object.
 */
export function fromResult<T, E>(
  result: Result<T, E>,
  errorCode = 'OPERATION_FAILED'
): McpToolReply {
  if (result.success) return formatOk(result.data);
  const error = result.error as unknown;
  const errType =
    typeof error === 'object' && error !== null && 'type' in error
      ? String((error as { type: unknown }).type)
      : undefined;
  const errMessage =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message ?? errType ?? errorCode)
      : typeof error === 'string'
        ? error
        : (errType ?? errorCode);
  return formatErr(errType ?? errorCode, errMessage, error);
}

/**
 * Wraps a tool handler so its invocation is recorded in the recent-calls
 * ring buffer (tool name, duration, success/failure). Caller should use the
 * returned function as the handler passed to `server.registerTool`.
 *
 * The wrapper also normalises thrown exceptions into a structured
 * `UNHANDLED` error reply so the SDK never sees a rejected promise — that
 * keeps the protocol response consistent and means recent-calls always
 * captures the true latency.
 */
export function withRecording<Args>(
  name: string,
  handler: (args: Args) => Promise<McpToolReply> | McpToolReply
): (args: Args) => Promise<McpToolReply> {
  return async (args: Args): Promise<McpToolReply> => {
    const startedAt = Date.now();
    try {
      const reply = await handler(args);
      const ms = Date.now() - startedAt;
      const status: 'ok' | 'error' = 'isError' in reply && reply.isError ? 'error' : 'ok';
      recentCallsRing.record({ tool: name, ms, status });
      return reply;
    } catch (err) {
      const ms = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      recentCallsRing.record({ tool: name, ms, status: 'error', error: message });
      return formatErr('UNHANDLED', message);
    }
  };
}
