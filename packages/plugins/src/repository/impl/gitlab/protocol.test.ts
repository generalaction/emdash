import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createRepository, deleteRepository, listOwners } from './index';

const requests: Array<{ method: string; url: string; token: string | undefined; body: string }> =
  [];
const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  requests.push({
    method: request.method ?? '',
    url: request.url ?? '',
    token: request.headers['private-token'] as string | undefined,
    body,
  });
  response.setHeader('content-type', 'application/json');
  const path = decodeURIComponent(new URL(request.url ?? '', 'http://localhost').pathname);
  if (path === '/gitlab/api/v4/user') {
    response.end(JSON.stringify({ username: 'alice', namespace_id: 7, avatar_url: '' }));
  } else if (path === '/gitlab/api/v4/groups' && request.method === 'GET') {
    response.end(
      JSON.stringify([
        {
          id: 10,
          full_path: 'acme/platform',
          project_creation_level: 'developer',
          avatar_url: null,
        },
      ])
    );
  } else if (path === '/gitlab/api/v4/groups/acme/platform') {
    response.end(JSON.stringify({ id: 10 }));
  } else if (path === '/gitlab/api/v4/projects' && request.method === 'POST') {
    response.end(
      JSON.stringify({
        web_url: 'http://gitlab.example/acme/platform/new',
        http_url_to_repo: 'http://gitlab.example/acme/platform/new.git',
        ssh_url_to_repo: 'git@gitlab.example:acme/platform/new.git',
        path_with_namespace: 'acme/platform/new',
        default_branch: 'main',
      })
    );
  } else if (path === '/gitlab/api/v4/projects/acme/platform/new') {
    response.statusCode = 204;
    response.end();
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
});

afterEach(async () => {
  requests.length = 0;
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('sends nested group operations to a self-hosted GitLab API path', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server port');
  const host = {
    credentials: {
      instanceUrl: `http://127.0.0.1:${address.port}/gitlab`,
      apiToken: 'test-token',
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as ConnectedIntegrationHostContext;

  expect((await listOwners(host)).success).toBe(true);
  expect(
    (await createRepository(host, { owner: 'acme/platform', name: 'new', visibility: 'private' }))
      .success
  ).toBe(true);
  expect((await deleteRepository(host, { owner: 'acme/platform', name: 'new' })).success).toBe(
    true
  );
  expect(requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: 'GET', url: '/gitlab/api/v4/user' }),
      expect.objectContaining({ method: 'GET', url: '/gitlab/api/v4/groups/acme%2Fplatform' }),
      expect.objectContaining({ method: 'POST', url: '/gitlab/api/v4/projects' }),
      expect.objectContaining({
        method: 'DELETE',
        url: '/gitlab/api/v4/projects/acme%2Fplatform%2Fnew',
      }),
    ])
  );
  expect(requests.every((request) => request.token === 'test-token')).toBe(true);
  expect(requests.find((request) => request.method === 'POST')?.body).toContain('namespace_id');
  expect(requests.find((request) => request.method === 'POST')?.body).toContain('10');
  expect(requests.some((request) => request.url.includes('min_access_level=30'))).toBe(true);
});
