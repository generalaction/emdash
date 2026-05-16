/**
 * Reads/writes `~/.emdash/mcp.json` containing `{ port, token, version }` at
 * mode `0600`.
 *
 * Eventual responsibilities:
 * - `readTokenFile()`: load and validate the persisted token file; refuse to
 *   surface the token if file permissions are too permissive.
 * - `writeTokenFile()`: persist the token atomically with mode `0600`.
 * - `regenerateToken()`: produce a fresh `crypto.randomBytes(32)` base64url
 *   token, persist it, and return the new value.
 *
 * Currently stubs — return undefined.
 */
export async function readTokenFile(): Promise<unknown> {
  return undefined;
}

export async function writeTokenFile(): Promise<unknown> {
  return undefined;
}

export async function regenerateToken(): Promise<unknown> {
  return undefined;
}
