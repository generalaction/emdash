import type { AcpSessionEvent } from '@shared/acp';
import { defineEvent } from '@shared/ipc/events';

export const acpSessionEventChannel = defineEvent<AcpSessionEvent>('acp:session-event');
