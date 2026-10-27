import { createEventStreamHost } from '@agent/wire/live';
import { conversationsContract } from '../api';

export const conversationWireEvents = createEventStreamHost(conversationsContract.events);
