import { log } from '@core/primitives/logging/browser/logger';
import { confirmOpenExternalLink } from './open-external-link';

/**
 * Opens a URL selected or linked in a terminal. The existing confirm modal
 * already offers Emdash's in-app browser pane when a task view is active, so
 * this routes through that gate instead of inventing a second browser surface.
 */
export function openTerminalUrl(url: string): void {
  confirmOpenExternalLink(url, (error) => {
    log.warn('[openTerminalUrl] failed to open external link', { url, error });
  });
}
