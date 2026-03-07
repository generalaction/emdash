import { protocol, net } from 'electron';
import { join, normalize, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://emdash`;

/**
 * Register the custom `app://` scheme as a privileged, secure origin.
 * Must be called before `app.whenReady()`.
 */
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

/**
 * Attach the file-serving handler for the `app://` scheme.
 * Must be called after `app.whenReady()`.
 *
 * Unknown paths fall back to `index.html` for SPA client-side routing.
 */
export function setupAppProtocol(rendererRoot: string): void {
  const root = normalize(rendererRoot);

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const relPath = decodeURIComponent(pathname).replace(/^\/+/, '');
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
