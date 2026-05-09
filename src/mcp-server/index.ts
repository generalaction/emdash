/**
 * emdash-mcp subprocess entry.
 *
 * Spawned by an agent CLI (Claude Code / Codex / Copilot CLI / etc.) per the
 * MCP config emdash writes to that CLI's settings file. Identity flows through
 * inherited PTY environment — see docs/mcp-internal-spec.md §4.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpClient } from './http-client';
import { IdentityError, loadIdentity } from './identity';
import { registerAllTools } from './tools';

async function main(): Promise<void> {
  let identity;
  try {
    identity = loadIdentity();
  } catch (err) {
    if (err instanceof IdentityError) {
      console.error(err.message);
      console.error(
        'emdash-mcp must be launched as a child of an emdash-managed agent CLI. ' +
          'If you are seeing this from a manual run, set the EMDASH_* env vars yourself or use emdash to spawn the conversation.'
      );
      process.exit(2);
    }
    throw err;
  }

  const server = new McpServer({ name: 'emdash', version: '0.1.0' });
  const http = new HttpClient(identity);
  registerAllTools(server, http);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('emdash-mcp: fatal', err);
  process.exit(1);
});
