import { createEventStreamHost } from '@emdash/wire';
import { automationsContract } from '../api';

export const automationEvents = createEventStreamHost(automationsContract.events);
