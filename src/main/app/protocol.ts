import { randomUUID } from 'node:crypto';
import { basename, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { APP_NAME_LOWER } from '@shared/app-identity';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_NAME_LOWER}`;

const WORKSPACE_FILE_PREFIX = '__workspace_file__';
const workspaceFileUrls = new Map<string, string>();

export function createWorkspaceFileUrl(filePath: string): string {
  const token = randomUUID();
  workspaceFileUrls.set(token, filePath);
  return `${APP_ORIGIN}/${WORKSPACE_FILE_PREFIX}/${token}/${encodeURIComponent(basename(filePath))}`;
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function setupAppProtocol(rendererRoot: string): void {
  const root = normalize(rendererRoot);

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const relPath = decodeURIComponent(pathname).replace(/^\/+/, '');

    if (relPath.startsWith(`${WORKSPACE_FILE_PREFIX}/`)) {
      const token = relPath.split('/')[1];
      const filePath = token ? workspaceFileUrls.get(token) : undefined;
      if (!filePath) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    }

    const resolved = normalize(join(root, relPath || 'index.html'));

    if (!resolved.startsWith(root + sep) && resolved !== root) {
      return new Response(null, { status: 403 });
    }

    try {
      return await net.fetch(`file://${resolved}`);
    } catch {
      return net.fetch(`file://${join(root, 'index.html')}`);
    }
  });
}
