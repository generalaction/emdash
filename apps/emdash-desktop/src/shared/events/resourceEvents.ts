import { defineEvent } from '@shared/lib/ipc/events';
import type { ResourceSnapshot } from '@shared/resource-monitor';

export const resourceSnapshotChannel = defineEvent<ResourceSnapshot>('resource-monitor:snapshot');
