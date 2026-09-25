import { createEventStreamHost } from '@emdash/wire/live';
import { integrationsContract } from '../api/contract';

export const integrationsEvents = createEventStreamHost(integrationsContract.events);
