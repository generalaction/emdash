import { createEventStreamHost } from '@agent/wire/live';
import { previewServersContract } from '../api';

export const previewServerEvents = createEventStreamHost(previewServersContract.events);
