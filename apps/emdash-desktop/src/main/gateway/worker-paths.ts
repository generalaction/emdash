import { fileURLToPath } from 'node:url';
import { desktopWorkers, type DesktopWorkerId } from '@core/manifests/node/workers';

export function desktopWorkerPath(id: DesktopWorkerId): string {
  return fileURLToPath(new URL(`./${desktopWorkers[id].file}`, import.meta.url));
}
