import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../host';

const log: ConnectedIntegrationHostContext['log'] = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

export function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function createYouTrackTestServer() {
  const requests: { url: URL; authorization: string | undefined }[] = [];
  const defaultHandler = (_request: IncomingMessage, response: ServerResponse) =>
    json(response, {}, 404);
  const http = {
    instanceUrl: '',
    requests,
    handler: defaultHandler,
    host(): ConnectedIntegrationHostContext {
      return { credentials: { instanceUrl: http.instanceUrl, apiToken: 'test-token' }, log };
    },
  };
  const server = createServer((request, response) => {
    requests.push({
      url: new URL(request.url ?? '/', http.instanceUrl),
      authorization: request.headers.authorization,
    });
    http.handler(request, response);
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    http.instanceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/youtrack`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  beforeEach(() => {
    requests.length = 0;
    http.handler = defaultHandler;
  });

  return http;
}
