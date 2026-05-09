import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HttpClient } from '../http-client';
import { registerAgentTools } from './agent';

export function registerAllTools(server: McpServer, http: HttpClient): void {
  registerAgentTools(server, http);
  // PR2: orchestration, terminals, workspace awareness, full Set A.
}
