/**
 * Shared helpers for MCP resource handlers.
 *
 * Resource read-callbacks all return the same `{ contents: [...] }` shape
 * defined by `ReadResourceResultSchema` in the MCP SDK. `formatResourceContent`
 * centralises that translation so per-domain resource modules stay focused
 * on what to put *into* the payload.
 *
 * `parseEmdashUri` is a small URI splitter shared by resource read-callbacks
 * that need to peel out the trailing path segments (project id, task id,
 * session id, …).
 *
 * Resource payloads are JSON-serialised text content with `application/json`
 * mime by default. The SDK schema also allows binary blobs, but emdash's v1
 * resources are all structured JSON.
 */
export type ResourceReadResult = {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
};

/**
 * Wrap a serialisable payload in the canonical
 * `ReadResourceResultSchema`-shaped reply.
 *
 * `payload` is JSON-stringified with 2-space indent (matches the tool layer's
 * `formatOk` for consistency in recent-calls / logs). For raw string payloads
 * the caller can pass `payload` as a string; we still JSON-encode it so the
 * `text` field is always valid JSON.
 */
export function formatResourceContent(
  uri: string,
  mime: string,
  payload: unknown
): ResourceReadResult {
  return {
    contents: [
      {
        uri,
        mimeType: mime,
        text: JSON.stringify(payload ?? null, null, 2),
      },
    ],
  };
}

/**
 * Parse an `emdash://...` URI into its scheme + path segments. Returns
 * `null` for any non-`emdash://` URI so callers can short-circuit.
 *
 * Examples:
 *   emdash://projects                                → { scheme: 'emdash', parts: ['projects'] }
 *   emdash://projects/abc/tasks                      → { scheme: 'emdash', parts: ['projects', 'abc', 'tasks'] }
 *   emdash://tasks/t-1/sessions/s-1                  → { scheme: 'emdash', parts: ['tasks', 't-1', 'sessions', 's-1'] }
 *
 * Note: the SDK already matches templated URIs against `ResourceTemplate`
 * patterns and passes the extracted variables into the read callback; this
 * helper exists for static-URI handlers and for tests that need a
 * lightweight parser without spinning up a `UriTemplate`.
 */
export function parseEmdashUri(uri: string): { scheme: string; parts: string[] } | null {
  // Use the standard URL parser so we get host/pathname normalisation for free.
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'emdash:') return null;
  // `emdash://projects/foo` → host='projects', pathname='/foo'
  const host = url.host;
  const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const tail = path.length > 0 ? path.split('/') : [];
  const parts = host.length > 0 ? [host, ...tail] : tail;
  return { scheme: 'emdash', parts };
}
