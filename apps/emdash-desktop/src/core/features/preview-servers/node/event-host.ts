import { createEventStreamHost } from '@emdash/wire/live';
import { previewServersContract } from '../api';

export const previewServerEvents = createEventStreamHost(previewServersContract.events);
