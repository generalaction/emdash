import { createServer } from 'node:http';
import { RPCHandler } from '@orpc/server/node';
import { router } from './router';

const port = Number(process.env['EMDASH_WORKSPACE_SERVER_PORT'] ?? 8787);
const handler = new RPCHandler(router);

const server = createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, { prefix: '/rpc', context: {} });
  if (!matched) {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(port, () => {
  process.stdout.write(`workspace-server listening on :${port}\n`);
});
