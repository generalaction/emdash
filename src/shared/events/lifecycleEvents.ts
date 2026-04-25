import { defineEvent } from '@shared/ipc/events';
import type { LifecycleEvent } from '@shared/lifecycle';

export const lifecycleEventChannel = defineEvent<LifecycleEvent>('lifecycle:event');
