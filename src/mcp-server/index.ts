import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpClient } from './http-client';
import { IdentityError, loadIdentity } from './identity';
import { registerAllTools } from './tools';

async function main(): Promise<void> {
  let identity;
  try {
    identity = loadIdentity();
  } catch (error) {
    if (error instanceof IdentityError) {
      console.error(error.message);
      console.error('emdash-mcp must be launched inside an Emdash-managed agent session.');
      process.exit(2);
    }
    throw error;
  }

  const server = new McpServer({ name: 'emdash', version: '0.1.0' });
  registerAllTools(server, new HttpClient(identity));
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error('emdash-mcp: fatal', error);
  process.exit(1);
});
